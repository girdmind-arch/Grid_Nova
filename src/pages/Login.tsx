// hi
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { Badge, Button, ThemeToggle } from "@/components/ui";
import { Logo } from "@/components/layout/Logo";
import { AUTH_REQUIRED, getDemoAccounts, signIn, type DemoAccount } from "@/services/auth";
import { useAuthStore } from "@/store/authStore";

const FIELD =
  "h-12 w-full rounded-md border border-border-strong bg-surface pl-10 pr-3 text-[16px] text-fg placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-none disabled:opacity-60";

/** Only same-app paths are allowed as the "go back to" target. */
function safeNext(next: string | null) {
  return next && next.startsWith("/app") ? next : "/app";
}

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("expired") ? "Your session ended. Please sign in again." : null);
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const userId = useId();
  const passId = useId();
  const errId = useId();
  const next = safeNext(params.get("next"));

  useEffect(() => {
    document.title = "Sign in · GridNova";
    if (AUTH_REQUIRED) void getDemoAccounts().then(setDemo);
  }, []);

  // Demo data has nothing to sign in to; an existing session skips the form.
  if (!AUTH_REQUIRED || session) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent, creds?: { username: string; password: string }) => {
    e.preventDefault();
    const u = (creds?.username ?? username).trim();
    const p = creds?.password ?? password;
    if (!u || !p || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await signIn(u, p));
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col px-[var(--gutter)] pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-[var(--content-max)] items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 rounded-md px-1 py-2 text-sm font-medium text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden className="size-4" /> Back to website
        </Link>
        <ThemeToggle />
      </div>

      <main id="main" className="mx-auto flex w-full flex-1 items-center justify-center py-8">
        <div className="glass-strong w-full max-w-[440px] rounded-2xl border border-glass-border bg-surface-solid/92 p-6 shadow-lg sm:p-8">
          <Logo className="mb-6" />
          <h1 className="text-[26px] leading-tight font-bold tracking-tight text-fg">Sign in to the Control Room</h1>
          <p className="mt-2 text-[15px] text-fg-muted">Operators can run scenarios and approve plans. Viewers can watch everything, read-only.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate aria-describedby={error ? errId : undefined}>
            <div>
              <label htmlFor={userId} className="text-sm font-semibold text-fg">
                User name
              </label>
              <div className="relative mt-1.5">
                <User aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-fg-subtle" strokeWidth={1.75} />
                <input
                  id={userId}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  className={FIELD}
                  placeholder="e.g. operator"
                />
              </div>
            </div>
            <div>
              <label htmlFor={passId} className="text-sm font-semibold text-fg">
                Password
              </label>
              <div className="relative mt-1.5">
                <Lock aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-fg-subtle" strokeWidth={1.75} />
                <input
                  id={passId}
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                  className={`${FIELD} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg"
                >
                  {show ? <EyeOff className="size-[18px]" strokeWidth={1.75} /> : <Eye className="size-[18px]" strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            {error && (
              <p id={errId} role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-fg">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !username.trim() || !password}>
              {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {demo.length > 0 && (
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-semibold text-fg">Try the demo</p>
              <p className="mt-1 text-sm text-fg-muted">This is a public demo, so you can sign in with a ready-made account.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {demo.map((a) => (
                  <Button key={a.username} type="button" size="sm" disabled={busy} onClick={(e) => void submit(e as unknown as FormEvent, a)} className="justify-between">
                    <span className="capitalize">{a.role}</span>
                    <Badge tone={a.role === "operator" ? "accent" : "neutral"} size="sm">
                      {a.role === "operator" ? "Can act" : "Read-only"}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
