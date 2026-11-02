import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormField, StatePanel } from "./components/primitives.js";
import { authRequest, type AuthData } from "./auth-api.js";
import { Icon } from "./icons.js";

export function AuthScreen({ onAuth }: { onAuth: (data: AuthData) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current !== mode) {
      headingRef.current?.focus({ preventScroll: true });
      previousMode.current = mode;
    }
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const data = await authRequest<AuthData>(mode, {
        email,
        password,
        ...(mode === "register" ? { displayName } : {}),
      });
      setPassword("");
      onAuth(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal masuk.");
      setPending(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-artwork" aria-hidden="true" />
      <section className="auth-intro" aria-labelledby="auth-intro-title">
        <div className="auth-brand">
          <img
            className="brand-wordmark"
            src="/opsmart-wordmark.png"
            alt="OpSmart"
          />
        </div>
        <div className="auth-intro-copy">
          <p className="section-kicker">Ruang kerja JagoFarm</p>
          <h1 id="auth-intro-title">Operasional farm, lebih tertata.</h1>
          <p>
            Susun farm dan unitnya dalam satu ruang kerja yang mudah diikuti.
          </p>
        </div>
      </section>
      <aside className="auth-overview" aria-label="Ruang kerja OpSmart">
        <ul className="auth-features">
          <li>
            <span className="auth-feature-icon">
              <Icon name="harvest" size={28} />
            </span>
            <span>
              <strong>Farm</strong>
              <small>Kelola lokasi dan unit</small>
            </span>
          </li>
          <li>
            <span className="auth-feature-icon">
              <Icon name="calendar" size={28} />
            </span>
            <span>
              <strong>Operasional</strong>
              <small>Catatan kegiatan harian</small>
            </span>
          </li>
          <li>
            <span className="auth-feature-icon">
              <Icon name="chart" size={28} />
            </span>
            <span>
              <strong>Laporan</strong>
              <small>Pantau progres dan hasil</small>
            </span>
          </li>
        </ul>
      </aside>
      <div className="auth-form-wrap">
        <section className="card auth-card" aria-labelledby="auth-form-title">
          <div className="auth-card-heading" key={mode}>
            <h2 id="auth-form-title" tabIndex={-1} ref={headingRef}>
              {mode === "login" ? "Masuk ke OpSmart" : "Buat akun OpSmart"}
            </h2>
            <p>Kelola farm dan catatan operasional dalam satu tempat.</p>
          </div>
          {error && (
            <StatePanel kind="error" title="Belum berhasil">
              {error}
            </StatePanel>
          )}
          <form onSubmit={(event) => void submit(event)} aria-busy={pending}>
            <div
              className={`auth-reveal ${mode === "register" ? "is-visible" : ""}`}
              aria-hidden={mode !== "register"}
              inert={mode !== "register"}
            >
              <div>
                <FormField id="auth-name" label="Nama">
                  <input
                    id="auth-name"
                    required={mode === "register"}
                    disabled={mode !== "register" || pending}
                    maxLength={120}
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </FormField>
              </div>
            </div>
            <FormField id="auth-email" label="Email">
              <input
                id="auth-email"
                required
                disabled={pending}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField id="auth-password" label="Kata sandi">
              <input
                id="auth-password"
                required
                disabled={pending}
                type="password"
                minLength={mode === "register" ? 12 : 1}
                maxLength={1024}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                aria-describedby={
                  mode === "register" ? "auth-password-hint" : undefined
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            <div
              className={`auth-reveal ${mode === "register" ? "is-visible" : ""}`}
              aria-hidden={mode !== "register"}
            >
              <div>
                <p className="auth-hint" id="auth-password-hint">
                  Gunakan sedikitnya 12 karakter.
                </p>
              </div>
            </div>
            <button type="submit" disabled={pending}>
              {pending
                ? "Memproses…"
                : mode === "login"
                  ? "Masuk"
                  : "Buat akun"}
            </button>
          </form>
          <button
            type="button"
            className="auth-switch"
            disabled={pending}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            <span className="auth-switch-label" key={mode}>
              {mode === "login" ? (
                <>
                  Belum punya akun? <strong>Daftar</strong>
                </>
              ) : (
                <>
                  Sudah punya akun? <strong>Masuk</strong>
                </>
              )}
            </span>
          </button>
        </section>
      </div>
    </main>
  );
}
