import { Link } from "react-router";
import { FolderGit2 } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { LANDING_LINKS } from "./LandingHeader";

export const REPO_URL = "https://github.com/girdmind-arch/Grid_Nova";

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid w-full max-w-[var(--content-max)] gap-8 px-[var(--gutter)] py-10 sm:grid-cols-[1.4fr_1fr_1fr] lg:px-[var(--gutter-lg)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-fg-muted">A control room that thinks, acts, and explains.</p>
          <p className="mt-3 text-sm text-fg-subtle">Built for BITSETGO'26 · Agentic AI & ML</p>
        </div>
        <nav aria-label="Footer">
          <p className="micro-label text-fg-subtle">On this page</p>
          <ul className="mt-3 space-y-2 text-sm">
            {LANDING_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-fg-muted hover:text-fg">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="micro-label text-fg-subtle">Project</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/app" className="text-fg-muted hover:text-fg">
                Open the live demo
              </Link>
            </li>
            <li>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg">
                <FolderGit2 aria-hidden strokeWidth={1.75} className="size-4" /> Source code on GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] py-4 text-[13px] text-fg-subtle lg:px-[var(--gutter-lg)]">
          Simulated campus microgrid. No real grid is controlled from this site.
        </p>
      </div>
    </footer>
  );
}
