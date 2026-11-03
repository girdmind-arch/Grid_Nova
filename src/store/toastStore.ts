// hi
import { create } from "zustand";

export type ToastTone = "neutral" | "success" | "warning" | "danger" | "ai";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a toast from anywhere: toast({ title: "Goal updated", tone: "success" }). */
export function toast(input: Omit<Toast, "id" | "tone"> & { tone?: ToastTone; durationMs?: number }) {
  const id = nextId++;
  const { durationMs = 4500, tone = "neutral", ...rest } = input;
  useToastStore.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, tone, ...rest }] }));
  window.setTimeout(() => useToastStore.getState().dismiss(id), durationMs);
  return id;
}
