import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import { DomainError } from "../shared/errors.js";
import type { Database, Sql } from "./db.js";

const passwordOptions = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const sessionSeconds = 7 * 24 * 60 * 60;
const emailInput = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const registerInput = z
  .object({
    email: emailInput,
    password: z.string().min(12).max(1024),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();
const loginInput = z
  .object({ email: emailInput, password: z.string().min(1).max(1024) })
  .strict();
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
type Session = {
  userId: string;
  displayName: string;
  email: string;
  csrfToken: string;
  tokenHash: string;
};

export function createLocalAuth(
  db: Database,
  options: { origin: string; secureCookies: boolean },
) {
  const origin = new URL(options.origin).origin;
  const cookieName = options.secureCookies
    ? "__Host-opsmart_session"
    : "opsmart_session";
  const router = Router();

  function cookie(request: Request): string | null {
    const matches = (request.headers.cookie ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const value = matches[0]!.slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  async function session(request: Request): Promise<Session | null> {
    const raw = cookie(request);
    if (!raw) return null;
    return db.transaction(async (tx) => {
      const result = await tx.query<Session>(
        `SELECT u.id AS "userId",u.display_name AS "displayName",c.email,s.csrf_token AS "csrfToken",s.token_hash AS "tokenHash"
         FROM auth_session s JOIN app_user u ON u.auth_subject=s.auth_subject JOIN auth_credential c ON c.user_id=u.id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
        [sha256(raw)],
      );
      return result.rows[0] ?? null;
    });
  }
  function checkOrigin(request: Request) {
    if (request.get("origin") !== origin) throw new DomainError("FORBIDDEN");
  }
  function checkCsrf(request: Request, current: Session) {
    const supplied = request.get("x-csrf-token");
    if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied))
      throw new DomainError("FORBIDDEN");
    const actual = Buffer.from(supplied),
      expected = Buffer.from(current.csrfToken);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new DomainError("FORBIDDEN");
  }
  function setCookie(
    response: Response,
    token: string,
    seconds = sessionSeconds,
  ) {
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${options.secureCookies ? "; Secure" : ""}`,
    );
  }
  async function issue(tx: Sql, subject: string) {
    const token = randomToken(),
      csrfToken = randomToken();
    await tx.query(
      "INSERT INTO auth_session(token_hash,auth_subject,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [sha256(token), subject, csrfToken],
    );
    return { token, csrfToken };
  }
  async function hashPassword(password: string, salt: string) {
    return (
      await new Promise<Buffer>((resolve, reject) =>
        nodeScrypt(password, salt, 64, passwordOptions, (error, derived) =>
          error ? reject(error) : resolve(derived),
        ),
      )
    ).toString("hex");
  }
  function noStore(response: Response) {
    response.setHeader("Cache-Control", "no-store");
  }

  router.post("/register", async (request, response) => {
    checkOrigin(request);
    const input = registerInput.parse(request.body);
    const salt = randomToken(),
      hash = await hashPassword(input.password, salt);
    const data = await db.transaction(async (tx) => {
      const id = randomUUID(),
        subject = `local:${input.email}`;
      await tx.query(
        "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
        [id, subject, input.displayName],
      );
      await tx.query(
        "INSERT INTO auth_credential(user_id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)",
        [id, input.email, salt, hash],
      );
      const issued = await issue(tx, subject);
      return {
        issued,
        user: { id, displayName: input.displayName, email: input.email },
      };
    });
    setCookie(response, data.issued.token);
    noStore(response);
    response.json({
      data: { user: data.user, csrfToken: data.issued.csrfToken },
    });
  });

  router.post("/login", async (request, response) => {
    checkOrigin(request);
    const input = loginInput.parse(request.body),
      emailHash = sha256(input.email);
    const data = await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO auth_login_throttle(email_hash) VALUES($1) ON CONFLICT DO NOTHING",
        [emailHash],
      );
      const throttle = (
        await tx.query<{
          attempts: number;
          blocked: boolean;
          oldWindow: boolean;
        }>(
          "SELECT attempts,blocked_until>now() AS blocked,window_started_at<now()-interval '15 minutes' AS \"oldWindow\" FROM auth_login_throttle WHERE email_hash=$1 FOR UPDATE",
          [emailHash],
        )
      ).rows[0]!;
      if (throttle.blocked) throw new DomainError("UNAUTHORIZED");
      const account = (
        await tx.query<{
          id: string;
          displayName: string;
          authSubject: string;
          salt: string;
          hash: string;
        }>(
          `SELECT u.id,u.display_name AS "displayName",u.auth_subject AS "authSubject",c.password_salt AS salt,c.password_hash AS hash
         FROM auth_credential c JOIN app_user u ON u.id=c.user_id WHERE c.email=$1`,
          [input.email],
        )
      ).rows[0];
      const calculated = await hashPassword(
        input.password,
        account?.salt ?? "unknown-account-salt",
      );
      const known = account
        ? Buffer.from(account.hash, "hex")
        : Buffer.alloc(64);
      const valid =
        known.length === 64 &&
        timingSafeEqual(Buffer.from(calculated, "hex"), known);
      if (!account || !valid) {
        const attempts = (throttle.oldWindow ? 0 : throttle.attempts) + 1;
        await tx.query(
          "UPDATE auth_login_throttle SET attempts=$2,window_started_at=CASE WHEN $3 THEN now() ELSE window_started_at END,blocked_until=CASE WHEN $2>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE email_hash=$1",
          [emailHash, attempts, throttle.oldWindow],
        );
        return null;
      }
      await tx.query(
        "UPDATE auth_login_throttle SET attempts=0,window_started_at=now(),blocked_until=NULL WHERE email_hash=$1",
        [emailHash],
      );
      const issued = await issue(tx, account.authSubject);
      return {
        issued,
        user: {
          id: account.id,
          displayName: account.displayName,
          email: input.email,
        },
      };
    });
    if (!data) throw new DomainError("UNAUTHORIZED");
    setCookie(response, data.issued.token);
    noStore(response);
    response.json({
      data: { user: data.user, csrfToken: data.issued.csrfToken },
    });
  });

  router.get("/me", async (request, response) => {
    const current = await session(request);
    if (!current) throw new DomainError("UNAUTHORIZED");
    noStore(response);
    response.json({
      data: {
        user: {
          id: current.userId,
          displayName: current.displayName,
          email: current.email,
        },
        csrfToken: current.csrfToken,
      },
    });
  });

  router.post("/logout", async (request, response) => {
    checkOrigin(request);
    const current = await session(request);
    if (!current) throw new DomainError("UNAUTHORIZED");
    checkCsrf(request, current);
    await db.transaction((tx) =>
      tx.query("UPDATE auth_session SET revoked_at=now() WHERE token_hash=$1", [
        current.tokenHash,
      ]),
    );
    setCookie(response, "", 0);
    noStore(response);
    response.json({ data: { signedOut: true } });
  });

  const protectMutation: RequestHandler = async (request, _response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    try {
      checkOrigin(request);
      const current = await session(request);
      if (!current) throw new DomainError("UNAUTHORIZED");
      checkCsrf(request, current);
      next();
    } catch (error) {
      next(error);
    }
  };
  return {
    router,
    protectMutation,
    resolveIdentity: async (request: Request) => {
      const current = await session(request);
      return current ? { userId: current.userId } : null;
    },
  };
}
