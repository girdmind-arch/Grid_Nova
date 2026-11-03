// hi
import { API_URL, USE_MOCKS, ServiceError } from "./api";
import { SIGNED_OUT_EVENT, readSession, writeSession, type Role, type Session } from "./session";

// Sign-in talks to the FastAPI backend. On demo data (no backend) there is nothing to
// sign in to, so the app opens straight away as an operator.

const BASE = API_URL === "/" ? "" : (API_URL ?? "").replace(/\/$/, "");

export interface DemoAccount {
  username: string;
  password: string;
  role: Role;
}

export const AUTH_REQUIRED = !USE_MOCKS;

export async function signIn(username: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new ServiceError("The service is unreachable. Check your connection and try again.");
  }
  if (res.status === 401) throw new ServiceError("Wrong user name or password.");
  if (res.status === 429) throw new ServiceError("Too many attempts. Wait a few minutes and try again.");
  if (!res.ok) throw new ServiceError("Sign-in is not available right now. Please try again.");
  const data = (await res.json()) as { token: string; expiresAt: number; user: { name: string; role: Role } };
  const session: Session = { token: data.token, expiresAt: data.expiresAt, name: data.user.name, role: data.user.role };
  writeSession(session);
  return session;
}

export function signOut() {
  writeSession(null);
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

/** Demo accounts the backend offers on the sign-in page (empty when real accounts are set). */
export async function getDemoAccounts(): Promise<DemoAccount[]> {
  try {
    const res = await fetch(`${BASE}/api/auth/demo`);
    if (!res.ok) return [];
    return ((await res.json()) as { accounts: DemoAccount[] }).accounts;
  } catch {
    return [];
  }
}

export { readSession };
