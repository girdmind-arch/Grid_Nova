// Tiny HTTP helper for the real FastAPI backend.
// Set VITE_API_URL (e.g. http://localhost:8000) in .env.local to switch the
// services from mock data to the backend. Use "/" when the backend serves this
// website itself (same origin). No API keys belong in the frontend.

export const API_URL: string | undefined = import.meta.env.VITE_API_URL || undefined;
export const USE_MOCKS = !API_URL;
const API_BASE = API_URL === "/" ? "" : (API_URL ?? "").replace(/\/$/, "");

import { SIGNED_OUT_EVENT, getToken, writeSession } from "./session";

/** Error with a human-readable message the UI can show as-is. */
export class ServiceError extends Error {}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const token = getToken();
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    });
  } catch {
    throw new ServiceError("The AI service is unreachable. Safe rule-based control is active.");
  }
  if (res.status === 401) {
    // The session ended (or the server restarted): back to the sign-in page.
    writeSession(null);
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ServiceError("Your session ended. Please sign in again.");
  }
  if (res.status === 403) throw new ServiceError("This account is view-only. Sign in as an operator to make changes.");
  if (!res.ok) {
    if (path === "/api/chat") {
      const detail = await res.json().then((j: { detail?: unknown }) => j.detail).catch(() => null);
      if (typeof detail === "string") throw new ServiceError(detail);
    }
    // The rig's refusals are written for people ("Hardware is not armed..."): show them as they are.
    if (path.startsWith("/api/hardware/") && res.status >= 400 && res.status < 500) {
      const detail = await res.json().then((j: { detail?: unknown }) => j.detail).catch(() => null);
      if (typeof detail === "string") throw new ServiceError(detail);
    }
    throw new ServiceError("The AI service had a problem. Safe rule-based control is active.");
  }
  return res.json() as Promise<T>;
}

/** Simulates network latency for mocks, so loading states are visible. */
export const mockDelay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
