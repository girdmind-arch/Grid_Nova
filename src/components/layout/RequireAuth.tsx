// hi
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { AUTH_REQUIRED } from "@/services/auth";
import { readSession } from "@/services/session";
import { useAuthStore } from "@/store/authStore";

/** Wraps the /app pages: no valid session means the sign-in page (and back again afterwards). */
export function RequireAuth() {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const { pathname, search } = useLocation();

  // A token that expired while the tab was open: drop it.
  useEffect(() => {
    if (session && !readSession()) setSession(null);
  }, [session, setSession, pathname]);

  if (AUTH_REQUIRED && !session) {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  return <Outlet />;
}
