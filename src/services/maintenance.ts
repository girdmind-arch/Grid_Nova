import { API_URL, request } from "./api";
import { getToken } from "./session";

export type MaintenanceRole = "operator" | "viewer" | "technician";
export type TicketStatus = "open" | "triaged" | "assigned" | "in_progress" | "waiting_parts" | "resolved" | "closed";

export interface MaintenancePhoto { id: string; filename: string }
export interface MaintenanceComment { id: string; author: string; body: string; createdAt: string }
export interface MaintenanceWorkflow {
  ticket_id: string; category: string; problem: string; assistance: string; urgency: string;
  confidence: number; reviewNeeded: boolean; provider: string; state: string; version: number;
  approved_version?: number | null; approved_by?: string | null; approved_role?: string | null;
  approved_at?: string | null; rejection?: string | null; redirected_at?: string | null;
  submitted_at?: string | null; reference?: string | null; resolution_source?: string | null;
  resolution_details?: string | null; resolved_at?: string | null;
  history: { state: string; actor: string; details: string; created_at: string; createdAt: string }[];
  notes: { id: string; actor: string; body: string; evidence: string; createdAt: string }[];
}
export interface MaintenanceTicket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  severity?: number | null;
  status: TicketStatus;
  source: "real" | "simulated";
  incidentId?: string | null;
  location: string;
  reporter: string;
  assignee?: string | null;
  createdAt: string;
  updatedAt: string;
  photos: MaintenancePhoto[];
  comments: MaintenanceComment[];
  workflow?: MaintenanceWorkflow | null;
}
export interface MaintenanceStatus {
  storageReady: boolean;
  persistentStorageRequired: boolean;
  demoAccounts: boolean;
  maxPhotos: number;
  maxPhotoBytes: number;
}
export interface NewMaintenanceTicket {
  title: string; description: string; category: string; priority: string;
  source: "real" | "simulated"; incidentId: string; location: string; photos: File[];
}

export const TICKET_STATUSES: { id: TicketStatus; label: string }[] = [
  { id: "open", label: "Open" }, { id: "triaged", label: "Triaged" },
  { id: "assigned", label: "Assigned" }, { id: "in_progress", label: "In progress" },
  { id: "waiting_parts", label: "Waiting for parts" }, { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
];
export const TICKET_CATEGORIES = [
  { id: "ac_hvac", label: "AC / HVAC" }, { id: "grid_feeder", label: "Grid / feeder" },
  { id: "solar", label: "Solar" }, { id: "battery", label: "Battery" },
  { id: "wiring", label: "Wiring" }, { id: "safety", label: "Safety" }, { id: "other", label: "Other" },
];

export function getMaintenanceStatus() { return request<MaintenanceStatus>("/api/maintenance/status"); }
export function getMaintenanceTickets() { return request<MaintenanceTicket[]>("/api/maintenance/tickets"); }
export function createMaintenanceTicket(input: NewMaintenanceTicket) {
  const body = new FormData();
  for (const key of ["title", "description", "category", "priority", "source", "location"] as const) body.set(key, input[key]);
  if (input.incidentId) body.set("incident_id", input.incidentId);
  for (const file of input.photos) body.append("photos", file);
  return request<MaintenanceTicket>("/api/maintenance/tickets", { method: "POST", body });
}
export function updateMaintenanceTicket(id: string, input: { status?: TicketStatus; assignee?: string; comment?: string }) {
  return request<MaintenanceTicket>(`/api/maintenance/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function updateMaintenanceWorkflow(id: string, action: string, data: Record<string, unknown> = {}) {
  return request<MaintenanceTicket>(`/api/maintenance/tickets/${encodeURIComponent(id)}/workflow`, { method: "POST", body: JSON.stringify({ action, ...data }) });
}
export async function getMaintenancePhoto(ticketId: string, photoId: string): Promise<Blob> {
  const base = API_URL === "/" ? "" : (API_URL ?? "").replace(/\/$/, "");
  const res = await fetch(`${base}/api/maintenance/tickets/${encodeURIComponent(ticketId)}/photos/${encodeURIComponent(photoId)}`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });
  if (!res.ok) throw new Error("Could not load this private photo.");
  return res.blob();
}

export function deleteMaintenanceTicket(id: string) {
  return request<{ deleted: boolean }>(`/api/maintenance/tickets/${encodeURIComponent(id)}`, { method: "DELETE" });
}
