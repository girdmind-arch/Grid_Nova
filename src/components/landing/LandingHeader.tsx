import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button, ThemeToggle } from "@/components/ui";
import { Logo } from "@/components/layout/Logo";
import { AUTH_REQUIRED } from "@/services/auth";
import { useAuthStore } from "@/store/authStore";

export const LANDING_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#agents", label: "Agents" },
  { href: "#start", label: "Start here" },
];

/** Sticky site header: logo, section links (desktop), theme toggle, the demo button. */
export function LandingHeader() {
  const signedIn = !!useAuthStore((s) => s.session);
  return (
    <header className="sticky top-0 z-20 px-[var(--gutter)] pt-[calc(env(safe-area-inset-top)+12px)] lg:px-[var(--gutter-lg)]">
      <div className="glass-strong mx-auto flex h-[58px] w-full max-w-[var(--content-max)] items-center justify-between gap-4 rounded-xl border border-glass-border bg-surface-solid/92 px-3 shadow-md sm:px-4">
        <Logo />
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {LANDING_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="rounded-sm px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {AUTH_REQUIRED && !signedIn && (
            // On phones "Open app" already leads to sign-in; two buttons pushed it off the screen.
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
          <Button asChild variant="secondary" size="sm">
            <Link to="/app">
              {AUTH_REQUIRED && !signedIn ? "Open app" : "Live demo"} <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
