// hi
import { create } from "zustand";
import { AUTH_REQUIRED, readSession } from "@/services/auth";
import { SIGNED_OUT_EVENT, writeSession, type Role, type Session } from "@/services/session";

interface AuthState {
  session: Session | null;
  setSession: (s: Session | null) => void;
}

/** Who is signed in. On demo data there is no sign-in, so everyone is an operator. */
export const useAuthStore = create<AuthState>((set) => ({
  session: AUTH_REQUIRED ? readSession() : null,
  setSession: (session) => {
    writeSession(session);
    set({ session });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener(SIGNED_OUT_EVENT, () => useAuthStore.setState({ session: null }));
}

/** True when the user may change things (operators, and everyone on demo data). */
export function useCanAct(): boolean {
  const role: Role | undefined = useAuthStore((s) => s.session?.role);
  return !AUTH_REQUIRED || role === "operator";
}

/** Same check outside React (stores): true for operators and on demo data. */
export function canActNow(): boolean {
  return !AUTH_REQUIRED || useAuthStore.getState().session?.role === "operator";
}

export const VIEW_ONLY_MESSAGE = { title: "This account is view-only.", description: "Sign in as an operator to run scenarios or make changes.", tone: "warning" } as const;
