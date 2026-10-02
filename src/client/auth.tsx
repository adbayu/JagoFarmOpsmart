import { useState, type FormEvent } from "react";
import { Card, FormField, StatePanel } from "./components/primitives.js";
import { authRequest, type AuthData } from "./auth-api.js";

export function AuthScreen({ onAuth }: { onAuth: (data: AuthData) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-intro" aria-labelledby="auth-intro-title">
        <div className="auth-brand">
          <span className="brand-mark">
            <img src="/jagofarm-logo.png" alt="" />
          </span>
          <span className="brand-copy">
            <strong>OpSmart</strong>
            <small>by JagoFarm</small>
          </span>
        </div>
        <div className="auth-intro-copy">
          <p className="section-kicker">Ruang kerja JagoFarm</p>
          <h1 id="auth-intro-title">Operasional farm, lebih tertata.</h1>
          <p>
            Susun farm dan unitnya dalam satu ruang kerja yang mudah diikuti.
          </p>
        </div>
        <p className="auth-intro-footer">Tumbuh dalam satu ekosistem.</p>
      </section>
      <div className="auth-form-wrap">
        <Card
          className="auth-card"
          title={mode === "login" ? "Masuk ke OpSmart" : "Buat akun OpSmart"}
        >
          <p>Kelola farm dan catatan operasional dalam satu tempat.</p>
          {error && (
            <StatePanel kind="error" title="Belum berhasil">
              {error}
            </StatePanel>
          )}
          <form onSubmit={(event) => void submit(event)}>
            {mode === "register" && (
              <FormField id="auth-name" label="Nama">
                <input
                  id="auth-name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </FormField>
            )}
            <FormField id="auth-email" label="Email">
              <input
                id="auth-email"
                required
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
                type="password"
                minLength={mode === "register" ? 12 : 1}
                maxLength={1024}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            {mode === "register" && (
              <p className="auth-hint">Gunakan sedikitnya 12 karakter.</p>
            )}
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
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login"
              ? "Belum punya akun? Daftar"
              : "Sudah punya akun? Masuk"}
          </button>
        </Card>
      </div>
    </div>
  );
}
