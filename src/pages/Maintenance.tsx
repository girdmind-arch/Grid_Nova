import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, Camera, Check, ClipboardList, HardHat, ImagePlus, LoaderCircle, Plus, RefreshCw, Send, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { createMaintenanceTicket, deleteMaintenanceTicket, getMaintenancePhoto, getMaintenanceStatus, getMaintenanceTickets, TICKET_CATEGORIES, TICKET_STATUSES, updateMaintenanceTicket, updateMaintenanceWorkflow, type MaintenanceStatus, type MaintenanceTicket, type TicketStatus } from "@/services";
import { cn } from "@/utils/cn";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const categoryName = (id: string) => TICKET_CATEGORIES.find((item) => item.id === id)?.label ?? "Other";
const statusName = (id: string) => TICKET_STATUSES.find((item) => item.id === id)?.label ?? id;
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function SourceTag({ source }: { source: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", source === "real" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-accent/10 text-accent")}>{source === "real" ? <AlertTriangle className="size-3.5" /> : <ShieldCheck className="size-3.5" />}{source === "real" ? "Reported · unverified" : "Simulated"}</span>;
}

function NewReport({ disabled, demoAccounts, onCreated }: { disabled: boolean; demoAccounts: boolean; onCreated: (ticket: MaintenanceTicket) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [source, setSource] = useState<"real" | "simulated">("real");
  useEffect(() => { if (demoAccounts) setSource("simulated"); }, [demoAccounts]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError("");
    try {
      const ticket = await createMaintenanceTicket({
        title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""),
        category: String(form.get("category") ?? "other"), priority: String(form.get("priority") ?? "normal"),
        source, incidentId: String(form.get("incidentId") ?? ""), location: String(form.get("location") ?? ""), photos,
      });
      onCreated(ticket); formElement.reset(); setPhotos([]); setSource("real");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create this report."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="font-semibold text-fg">Report a fault</h2><p className="mt-0.5 text-sm text-fg-muted">Give the repair team enough detail to respond.</p></div>
      <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent"><ImagePlus className="size-5" /></span>
    </div>
    <fieldset disabled={disabled || busy} className="space-y-3 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-fg">Report type<select name="source" value={source} onChange={(e) => setSource(e.target.value as "real" | "simulated")} className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="real" disabled={demoAccounts}>Real-world report</option><option value="simulated">Simulated scenario</option></select></label>
        <label className="text-sm font-medium text-fg">Fault category<select name="category" className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm">{TICKET_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      {source === "real" && demoAccounts && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-fg-muted">Real reports unlock when private staff accounts replace the public demo sign-ins.</p>}
      <label className="block text-sm font-medium text-fg">Short title<input name="title" required maxLength={120} placeholder="e.g. AC not cooling in Block C" className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-fg-subtle" /></label>
      <label className="block text-sm font-medium text-fg">What happened?<textarea name="description" required maxLength={4000} rows={3} placeholder="Describe what you noticed, when it started, and any safety concerns." className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-sm placeholder:text-fg-subtle" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-fg">Location<input name="location" required maxLength={160} placeholder="Building, floor, room or equipment ID" className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-fg-subtle" /></label>
        <label className="text-sm font-medium text-fg">Priority<select name="priority" className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm">{PRIORITIES.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
      </div>
      {source === "simulated" && <label className="block text-sm font-medium text-fg">Scenario / incident ID <span className="font-normal text-fg-subtle">(optional)</span><input name="incidentId" maxLength={80} placeholder="Link this report to a Scenarios incident" className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-fg-subtle" /></label>}
      <div>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-sm font-medium text-fg-muted hover:border-accent/50"><Camera className="size-4" /> Add photos <span className="text-xs font-normal text-fg-subtle">Up to 5 · JPEG, PNG or WebP · 6 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { setPhotos(Array.from(e.target.files ?? []).slice(0, 5)); e.currentTarget.value = ""; }} /></label>
        {!!photos.length && <div className="mt-2 flex flex-wrap gap-2">{photos.map((file, index) => <span key={`${file.name}-${index}`} className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs text-fg-muted">{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setPhotos((items) => items.filter((_, i) => i !== index))}><X className="size-3.5" /></button></span>)}</div>}
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="submit" variant="primary" disabled={disabled || busy} className="w-full">{busy ? <LoaderCircle className="animate-spin" /> : <Plus />} Submit maintenance report</Button>
    {disabled && <p className="text-xs leading-relaxed text-fg-subtle">Reports are paused until persistent storage is attached and configured.</p>}
  </form>;
}

function TicketDetail({ ticket, role, onUpdated, onDeleted }: { ticket: MaintenanceTicket; role: string; onUpdated: (ticket: MaintenanceTicket) => void; onDeleted: (ticket: MaintenanceTicket) => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [assignee, setAssignee] = useState(ticket.assignee ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [problem, setProblem] = useState(ticket.workflow?.problem ?? ticket.title);
  const [assistance, setAssistance] = useState(ticket.workflow?.assistance ?? "");
  const [workflowCategory, setWorkflowCategory] = useState(ticket.workflow?.category ?? ticket.category);
  const [workflowConfidence, setWorkflowConfidence] = useState(ticket.workflow?.confidence ?? 0.8);
  const [reviewNeeded, setReviewNeeded] = useState(ticket.workflow?.reviewNeeded ?? false);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reference, setReference] = useState("");
  const [resolution, setResolution] = useState("");
  useEffect(() => {
    setStatus(ticket.status); setAssignee(ticket.assignee ?? "");
    setProblem(ticket.workflow?.problem ?? ticket.title); setAssistance(ticket.workflow?.assistance ?? "");
    setWorkflowCategory(ticket.workflow?.category ?? ticket.category); setWorkflowConfidence(ticket.workflow?.confidence ?? 0.8);
    setReviewNeeded(ticket.workflow?.reviewNeeded ?? false);
  }, [ticket.status, ticket.assignee, ticket.title, ticket.category, ticket.workflow?.problem, ticket.workflow?.assistance, ticket.workflow?.category, ticket.workflow?.confidence, ticket.workflow?.reviewNeeded]);
  const canManage = role === "operator" || role === "technician";
  const flow = ticket.workflow;
  const isOwner = useAuthStore((state) => state.session?.name?.toLowerCase() === ticket.reporter.toLowerCase());
  const canApprove = role === "operator" || (role === "viewer" && isOwner);
  const providerFor = (category: string) => ({ grid_feeder: "GridNova Feeder Services (Simulation)", solar: "GridNova SolarCare (Simulation)", battery: "GridNova Battery Support (Simulation)", ac_hvac: "GridNova Climate Services (Simulation)", wiring: "GridNova Electrical Safety Services (Simulation)", safety: "GridNova Electrical Safety Services (Simulation)", other: "GridNova General Maintenance (Simulation)" }[category] ?? "GridNova General Maintenance (Simulation)");
  async function workflowAction(action: string, data: Record<string, unknown> = {}) {
    setWorkflowBusy(true); setWorkflowError("");
    try { const updated = await updateMaintenanceWorkflow(ticket.id, action, data); onUpdated(updated); return true; }
    catch (reason) { setWorkflowError(reason instanceof Error ? reason.message : "Could not update the maintenance workflow."); return false; }
    finally { setWorkflowBusy(false); }
  }
  async function openProvider() {
    if (flow?.state !== "redirected" && flow?.state !== "submitted" && flow?.state !== "in_progress" && flow?.state !== "resolved") {
      if (!await workflowAction("redirect")) return;
    }
    setProviderOpen(true);
  }

  async function save() {
    setBusy(true); setError("");
    try {
      const updated = await updateMaintenanceTicket(ticket.id, { status, ...(role === "operator" ? { assignee } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setComment(""); onUpdated(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this ticket."); }
    finally { setBusy(false); }
  }

  async function removeTicket() {
    if (!window.confirm(`Delete “${ticket.title}”? This permanently removes the ticket and its attached photos and updates.`)) return;
    setBusy(true); setError("");
    try {
      await deleteMaintenanceTicket(ticket.id);
      onDeleted(ticket);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this ticket."); }
    finally { setBusy(false); }
  }

  async function openPhoto(id: string) {
    try { const blob = await getMaintenancePhoto(ticket.id, id); setPhotoUrl(URL.createObjectURL(blob)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load photo."); }
  }

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2"><SourceTag source={ticket.source} /><span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">{categoryName(ticket.category)}</span><span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">{ticket.priority} priority</span>{ticket.severity != null && <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">Severity {ticket.severity}/5</span>}</div>
    <div><h2 className="text-xl font-bold text-fg">{ticket.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{ticket.description}</p></div>
    <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-sunken p-3 text-sm"><div><dt className="text-xs text-fg-subtle">Location</dt><dd className="mt-1 font-medium text-fg">{ticket.location}</dd></div><div><dt className="text-xs text-fg-subtle">Reported by</dt><dd className="mt-1 font-medium text-fg">{ticket.reporter}</dd></div><div><dt className="text-xs text-fg-subtle">Opened</dt><dd className="mt-1 text-fg">{dateLabel(ticket.createdAt)}</dd></div><div><dt className="text-xs text-fg-subtle">Assigned to</dt><dd className="mt-1 text-fg">{ticket.assignee || "Unassigned"}</dd></div><div className="col-span-2"><dt className="text-xs text-fg-subtle">Ticket ID</dt><dd className="mt-1 break-all font-mono text-xs text-fg">{ticket.id}</dd></div>{ticket.incidentId && <div className="col-span-2"><dt className="text-xs text-fg-subtle">Linked simulated incident</dt><dd className="mt-1 font-mono text-xs text-fg">{ticket.incidentId}</dd></div>}</dl>
    {ticket.photos.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-fg">Attached photos <span className="font-normal text-fg-subtle">({ticket.photos.length})</span></h3><div className="flex flex-wrap gap-2">{ticket.photos.map((photo) => <button key={photo.id} type="button" onClick={() => void openPhoto(photo.id)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-fg-muted hover:border-accent/50"><Camera className="size-4" />{photo.filename}</button>)}</div></div>}
    {ticket.comments.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-fg">Updates</h3><ol className="space-y-2 border-l border-border pl-4">{ticket.comments.map((item) => <li key={item.id}><p className="text-sm text-fg">{item.body}</p><p className="mt-1 text-xs text-fg-subtle">{item.author} · {dateLabel(item.createdAt)}</p></li>)}</ol></div>}
    {flow && <section aria-labelledby="workflow-heading" className="space-y-4 rounded-lg border border-accent/20 bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="workflow-heading" className="font-semibold text-fg">Simulated provider workflow</h3><p className="mt-1 text-xs text-fg-muted">Separate from the original report. No data is sent outside GridNova.</p></div><span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">{flow.state.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase())}</span></div>
      <dl className="grid gap-3 rounded-md bg-surface-sunken p-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">Suggested category</dt><dd className="mt-1 font-medium text-fg">{categoryName(flow.category)}</dd></div><div><dt className="text-xs text-fg-subtle">Specific problem</dt><dd className="mt-1 text-fg">{flow.problem}</dd></div><div><dt className="text-xs text-fg-subtle">Assistance needed</dt><dd className="mt-1 text-fg">{flow.assistance}</dd></div><div><dt className="text-xs text-fg-subtle">Urgency · confidence</dt><dd className="mt-1 text-fg">{flow.urgency} · {Math.round(flow.confidence * 100)}%</dd></div><div className="sm:col-span-2"><dt className="text-xs text-fg-subtle">Suggested destination</dt><dd className="mt-1 flex flex-wrap items-center gap-2 font-medium text-fg">{flow.provider}<span className="rounded-full border border-accent/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">Simulation</span></dd></div></dl>
      {flow.reviewNeeded && <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-fg">Review needed: the category is ambiguous or confidence is low. An operator can correct the proposed route.</p>}
      {flow.approved_at && <p className="text-xs text-fg-muted">Approved by {flow.approved_by} ({flow.approved_role}) · {dateLabel(flow.approved_at)} · version {flow.approved_version}</p>}{flow.rejection && <p className="text-sm text-danger">Rejected: {flow.rejection}</p>}
      {canApprove && ["pending_approval", "review_needed", "rejected", "withdrawn"].includes(flow.state) && <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" disabled={workflowBusy || flow.reviewNeeded} onClick={() => void workflowAction("approve")}>{workflowBusy ? <LoaderCircle className="animate-spin" /> : <Check />} Approve proposed route</Button>{flow.state !== "rejected" && <Button size="sm" disabled={workflowBusy} onClick={() => void workflowAction("reject", { reason: "Approval rejected by reviewer." })}>Reject</Button>}</div>}
      {canApprove && flow.state === "approved" && <Button size="sm" disabled={workflowBusy} onClick={() => void workflowAction("withdraw")}>Withdraw approval</Button>}
      {role === "operator" && ["pending_approval", "review_needed", "rejected", "withdrawn", "approved"].includes(flow.state) && <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium text-fg">Review or correct classification</summary><div className="mt-3 space-y-3"><label className="block text-xs font-medium text-fg-muted">Category<select value={workflowCategory} onChange={(e) => setWorkflowCategory(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2 text-sm">{TICKET_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="block text-xs font-medium text-fg-muted">Specific problem<input value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={240} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2 text-sm" /></label><label className="block text-xs font-medium text-fg-muted">Assistance needed<textarea value={assistance} onChange={(e) => setAssistance(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-2 text-sm" /></label><label className="block text-xs font-medium text-fg-muted">Classification confidence (0–100%)<input type="number" min={0} max={100} value={Math.round(workflowConfidence * 100)} onChange={(e) => setWorkflowConfidence(Math.max(0, Math.min(100, Number(e.target.value))) / 100)} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2 text-sm" /></label><label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={reviewNeeded} onChange={(e) => setReviewNeeded(e.target.checked)} /> Keep flagged for further review</label><p className="text-xs text-fg-muted">Destination: {providerFor(workflowCategory)}</p><Button size="sm" disabled={workflowBusy} onClick={() => void workflowAction("revise", { category: workflowCategory, problem, assistance, provider: providerFor(workflowCategory), confidence: workflowConfidence, reviewNeeded })}>Save proposed route</Button></div></details>}
      {flow.approved_version === flow.version && ["approved", "redirected", "submitted", "in_progress", "resolved"].includes(flow.state) && <div className="space-y-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" disabled={workflowBusy} onClick={() => void openProvider()}><ArrowUpRight /> {flow.state === "approved" ? "Open simulated destination" : "View simulated destination"}</Button>{flow.state === "redirected" && <Button size="sm" disabled={workflowBusy} onClick={() => void workflowAction("submit", { reference })}><Check /> Record submitted</Button>}</div>{flow.state === "approved" && <p className="text-xs text-fg-muted">Approved. Opening the destination records Redirected; it does not mark the report submitted.</p>}</div>}
      {providerOpen && <div className="space-y-2 rounded-md border border-accent/25 bg-surface p-3"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-fg">{flow.provider} <span className="font-normal text-accent">· Simulation</span></h4><button type="button" aria-label="Close simulated destination" onClick={() => setProviderOpen(false)}><X className="size-4" /></button></div><p className="text-xs text-fg-muted">In-app mock destination. Nothing is transmitted externally.</p><p className="text-sm text-fg"><strong>{ticket.title}</strong> · {ticket.location} · {ticket.priority} priority</p><p className="whitespace-pre-wrap text-xs text-fg-muted">{ticket.description}</p></div>}
      {flow.state === "submitted" || flow.state === "in_progress" ? <div className="space-y-3 border-t border-border pt-3"><h4 className="text-sm font-semibold text-fg">Progress update</h4><label className="block text-xs font-medium text-fg-muted">Simulated provider reference<input value={reference || flow.reference || ""} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Optional reference number" className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2 text-sm" /></label><label className="block text-xs font-medium text-fg-muted">Progress note<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-2 text-sm" /></label><label className="block text-xs font-medium text-fg-muted">Evidence or context<input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2 text-sm" /></label><Button size="sm" disabled={workflowBusy || !note.trim() && !evidence.trim()} onClick={async () => { if (await workflowAction("progress", { note, evidence, reference })) { setNote(""); setEvidence(""); } }}>Save progress</Button></div> : null}
      {["submitted", "in_progress"].includes(flow.state) && (canApprove || role === "technician" && ticket.assignee?.toLowerCase() === useAuthStore.getState().session?.name.toLowerCase()) && <div className="space-y-2 border-t border-border pt-3"><h4 className="text-sm font-semibold text-fg">Confirm resolution</h4><label className="block text-xs font-medium text-fg-muted">Resolution details<textarea value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-2 text-sm" /></label><div className="flex flex-wrap gap-2">{canApprove && <Button size="sm" disabled={workflowBusy || !resolution.trim()} onClick={() => void workflowAction("resolve", { details: resolution, source: isOwner ? "user_confirmation" : "operator_confirmation" })}>Confirm resolved</Button>}{role === "technician" && ticket.assignee?.toLowerCase() === useAuthStore.getState().session?.name.toLowerCase() && <Button size="sm" disabled={workflowBusy || !resolution.trim()} onClick={() => void workflowAction("resolve", { details: resolution, source: "provider_update" })}>Record provider resolution</Button>}</div></div>}
      {flow.state === "resolved" && <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm"><p className="font-semibold text-fg">Resolved · {flow.resolution_source?.replaceAll("_", " ")}</p><p className="mt-1 text-fg-muted">{flow.resolution_details}</p>{flow.reference && <p className="mt-1 text-xs text-fg-muted">Reference: {flow.reference}</p>}</div>}
      {flow.history.length > 0 && <div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Workflow timeline</h4><ol className="space-y-2 border-l border-border pl-4">{flow.history.map((item, index) => <li key={`${item.createdAt}-${index}`}><p className="text-xs font-semibold text-fg">{item.state.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase())}</p><p className="text-xs text-fg-muted">{item.details}</p><p className="mt-0.5 text-[10px] text-fg-subtle">{item.actor} · {dateLabel(item.createdAt)}</p></li>)}</ol></div>}
      {flow.notes.length > 0 && <div><h4 className="mb-2 text-xs font-semibold text-fg">Progress notes</h4><ul className="space-y-2">{flow.notes.map((item) => <li key={item.id} className="rounded-md bg-surface-sunken p-2 text-xs"><p className="text-fg">{item.body || "Evidence added"}</p>{item.evidence && <p className="mt-1 text-fg-muted">Evidence: {item.evidence}</p>}<p className="mt-1 text-fg-subtle">{item.actor} · {dateLabel(item.createdAt)}</p></li>)}</ul></div>}
      {workflowError && <p role="alert" className="text-sm text-danger">{workflowError}</p>}
    </section>}
    {canManage && <div className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold text-fg">Update ticket</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-fg-muted">Status<select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)} className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm">{TICKET_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{role === "operator" && <label className="text-xs font-medium text-fg-muted">Technician assignment<input value={assignee} onChange={(e) => setAssignee(e.target.value)} maxLength={64} placeholder="Technician username" className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm" /></label>}</div><label className="block text-xs font-medium text-fg-muted">Add an update<textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} placeholder="Work completed, parts needed, next steps…" className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" /></label><div className="flex flex-wrap gap-2"><Button variant="primary" size="sm" disabled={busy || status === ticket.status && assignee === (ticket.assignee ?? "") && !comment.trim()} onClick={() => void save()}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />} Save update</Button>{role === "operator" && <Button variant="danger" size="sm" disabled={busy} onClick={() => void removeTicket()}><Trash2 /> Delete ticket</Button>}</div></div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {photoUrl && <div role="dialog" aria-modal="true" aria-label="Maintenance photo" onClick={() => setPhotoUrl("")} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-5"><button className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white" aria-label="Close photo"><X /></button><img src={photoUrl} alt="Uploaded fault report" onClick={(event) => event.stopPropagation()} className="max-h-[85vh] max-w-full rounded-lg object-contain" /></div>}
  </div>;
}

export default function Maintenance() {
  const session = useAuthStore((state) => state.session);
  const role = session?.role ?? "operator";
  const [storage, setStorage] = useState<MaintenanceStatus | null>(null);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const refreshInFlight = useRef(false);
  const ticketVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const versionAtStart = ticketVersion.current;
    setError("");
    try {
      const [meta, items] = await Promise.all([getMaintenanceStatus(), getMaintenanceTickets()]);
      setStorage(meta);
      if (versionAtStart === ticketVersion.current) {
        setTickets(items);
        setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Maintenance service is unavailable."); }
    finally { setLoading(false); refreshInFlight.current = false; }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0];
  const shown = useMemo(() => filter === "all" ? tickets : tickets.filter((ticket) => ticket.status === filter), [tickets, filter]);
  const counts = useMemo(() => ({ open: tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length, urgent: tickets.filter((ticket) => ticket.priority === "urgent" && !["resolved", "closed"].includes(ticket.status)).length, done: tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length }), [tickets]);
  const upsert = (ticket: MaintenanceTicket) => { ticketVersion.current += 1; setTickets((existing) => [ticket, ...existing.filter((item) => item.id !== ticket.id)]); setSelectedId(ticket.id); };
  const storageMissing = storage?.storageReady === false;
  const handleDeleted = (ticket: MaintenanceTicket) => {
    ticketVersion.current += 1;
    setTickets((existing) => existing.filter((item) => item.id !== ticket.id));
    setSelectedId((current) => current === ticket.id ? "" : current);
    setSuccess(`Ticket “${ticket.title}” was deleted.`);
  };
  const canReport = role === "operator" || role === "viewer";

  return <div className="space-y-6">
    <PageHeader eyebrow="FIELD OPERATIONS" title="Maintenance" description="Report equipment issues, raise repair tickets, and track work through to resolution." actions={<Button size="sm" onClick={() => void refresh()}><RefreshCw /> Refresh</Button>} />
    {storageMissing && <div role="status" className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><span className="mt-0.5 text-amber-600"><AlertTriangle className="size-5" /></span><div><p className="text-sm font-semibold text-fg">Persistent storage needs setup</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-fg-muted">This deployment has no persistent maintenance volume configured. Ticket creation is paused so reports and photos are not lost on restart. Attach a persistent volume and set <code className="rounded bg-surface-sunken px-1">GRIDNOVA_MAINTENANCE_DIR</code> to its mount path to enable the service.</p></div></div>}
    {storage?.demoAccounts && <div className="flex gap-2 rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /><p>Real reports are manually submitted and unverified. Public demo accounts can only submit simulated tickets; private staff accounts are needed for real fault reports.</p></div>}
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}<button onClick={() => void refresh()} aria-label="Retry"><RefreshCw className="size-4" /></button></div>}
    {success && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}
    <div className="grid gap-3 sm:grid-cols-3"><Card padding="sm" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-accent/10 text-accent"><ClipboardList className="size-5" /></span><div><p className="text-xs text-fg-subtle">Active tickets</p><p className="font-mono text-2xl font-bold text-fg">{counts.open}</p></div></Card><Card padding="sm" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><AlertTriangle className="size-5" /></span><div><p className="text-xs text-fg-subtle">Urgent attention</p><p className="font-mono text-2xl font-bold text-fg">{counts.urgent}</p></div></Card><Card padding="sm" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600"><Check className="size-5" /></span><div><p className="text-xs text-fg-subtle">Resolved / closed</p><p className="font-mono text-2xl font-bold text-fg">{counts.done}</p></div></Card></div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,0.82fr)_minmax(360px,1.18fr)]">
      {canReport && <Card padding="md" className="xl:sticky xl:top-5"><NewReport disabled={loading || !storage?.storageReady} demoAccounts={!!storage?.demoAccounts} onCreated={upsert} /></Card>}
      <div className={cn("grid min-w-0 gap-5", canReport && "lg:grid-cols-[minmax(230px,0.8fr)_minmax(300px,1.2fr)]")}>
        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-border p-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-fg">Ticket queue</h2><span className="rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-xs text-fg-muted">{tickets.length}</span></div><label className="sr-only" htmlFor="ticket-filter">Filter tickets</label><select id="ticket-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-3 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm"><option value="all">All statuses</option>{TICKET_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="max-h-[620px] overflow-auto p-2">
            {loading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-fg-muted"><LoaderCircle className="size-4 animate-spin" />Loading tickets</div> : shown.length ? <ul className="space-y-1">{shown.map((ticket) => <li key={ticket.id}><button onClick={() => setSelectedId(ticket.id)} className={cn("w-full rounded-md p-3 text-left transition-colors", selected?.id === ticket.id ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface-sunken")}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-semibold text-fg">{ticket.title}</p><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", ticket.priority === "urgent" ? "bg-danger/10 text-danger" : ticket.priority === "high" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-surface-sunken text-fg-subtle")}>{ticket.priority}</span></div><p className="mt-1.5 text-xs text-fg-muted">{categoryName(ticket.category)} · {ticket.location}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs font-medium text-accent">{statusName(ticket.status)}</span><span className="truncate text-[10px] text-fg-subtle">{ticket.reporter}</span></div></button></li>)}</ul> : <div className="px-4 py-10 text-center"><Wrench className="mx-auto size-6 text-fg-subtle" /><p className="mt-2 text-sm font-medium text-fg">{tickets.length ? "No tickets in this status" : "No maintenance tickets yet"}</p><p className="mt-1 text-xs text-fg-subtle">{tickets.length ? "Choose another filter." : role === "technician" ? "Tickets assigned to you will appear here." : "New fault reports will appear in this queue."}</p></div>}
          </div>
        </Card>
        <Card padding="md" className="min-h-72">{selected ? <TicketDetail key={selected.id} ticket={selected} role={role} onUpdated={upsert} onDeleted={handleDeleted} /> : <div className="grid min-h-64 place-items-center text-center"><div><HardHat className="mx-auto size-8 text-fg-subtle" /><p className="mt-3 font-medium text-fg">Ticket details</p><p className="mt-1 text-sm text-fg-muted">Select a ticket to see updates and repair details.</p></div></div>}</Card>
      </div>
    </div>
    <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><HardHat className="size-3.5" />This page tracks reports and GridNova simulation or tabletop demo incidents; it does not monitor the real campus grid.<ArrowUpRight className="size-3.5" /></p>
  </div>;
}
