import { Suspense, useEffect } from "react";
import { useLocation, useOutlet } from "react-router";
import { Skeleton } from "@/components/ui";
import { motion } from "framer-motion";
import { prefetchPages } from "@/pages/loaders";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { ChatAssistant } from "./ChatAssistant";
import { useLiveBackend } from "@/hooks/useLiveBackend";
import { useCanAct } from "@/store/authStore";
import { Eye } from "lucide-react";

/** Layout for every /app page: sidebar (desktop), top bar, content, bottom nav (mobile). */
export function AppShell() {
  const { pathname } = useLocation();
  // useOutlet() captures the current page, so the old page can fade out
  // while the new one waits (a plain <Outlet /> would swap instantly).
  const outlet = useOutlet();
  useLiveBackend();
  const canAct = useCanAct();
  // Download the other pages in the background so switching is instant.
  useEffect(() => prefetchPages(), []);

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-[var(--sidebar-w)] print:pl-0">
        <TopBar />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] pt-6 pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+32px)] focus:outline-none sm:pt-8 lg:px-[var(--gutter-lg)] lg:pb-12 print:max-w-none print:p-0"
        >
          {!canAct && (
            <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
              <Eye aria-hidden className="size-4 shrink-0" strokeWidth={1.75} /> You are signed in as a viewer. Everything is visible; running scenarios and changes need an operator account.
            </p>
          )}
          {/* No exit animation: the new page swaps in at once and fades up quickly. */}
          <motion.div key={pathname} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.14, ease: "easeOut" }}>
            <Suspense fallback={<PageLoading />}>{outlet}</Suspense>
          </motion.div>
        </main>
      </div>
      <BottomNav />
      <ChatAssistant />
    </div>
  );
}

/** Shown for a moment the first time a page's code is downloaded. */
function PageLoading() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="mb-6 h-9 w-72" />
      <Skeleton className="h-56" />
    </div>
  );
}
