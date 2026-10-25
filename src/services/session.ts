// The signed-in session, kept in this browser. No imports on purpose: api.ts and the
// auth store both use it. localStorage can be blocked, so everything is try/catch.

export type Role = "operator" | "viewer" | "technician";

export interface Session {
  token: string;
  name: string;
  role: Role;
  /** Unix seconds. */
  expiresAt: number;
}

const KEY = "gridnova-session";
export const SIGNED_OUT_EVENT = "gridnova:signed-out";

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || s.expiresAt * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session just lasts until the page closes */
  }
}

export const getToken = () => readSession()?.token ?? null;
