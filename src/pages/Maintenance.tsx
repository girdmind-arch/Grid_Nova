import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, Camera, Check, ClipboardList, HardHat, ImagePlus, LoaderCircle, Plus, RefreshCw, Send, ShieldCheck, Wrench, X } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { createMaintenanceTicket, getMaintenancePhoto, getMaintenanceStatus, getMaintenanceTickets, TICKET_CATEGORIES, TICKET_STATUSES, updateMaintenanceTicket, type MaintenanceStatus, type MaintenanceTicket, type TicketStatus } from "@/services";
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

function TicketDetail({ ticket, role, onUpdated }: { ticket: MaintenanceTicket; role: string; onUpdated: (ticket: MaintenanceTicket) => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [assignee, setAssignee] = useState(ticket.assignee ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const canManage = role === "operator" || role === "technician";

  async function save() {
    setBusy(true); setError("");
    try {
      const updated = await updateMaintenanceTicket(ticket.id, { status, ...(role === "operator" ? { assignee } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setComment(""); onUpdated(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this ticket."); }
    finally { setBusy(false); }
  }

  async function openPhoto(id: string) {
    try { const blob = await getMaintenancePhoto(ticket.id, id); setPhotoUrl(URL.createObjectURL(blob)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load photo."); }
  }

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2"><SourceTag source={ticket.source} /><span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">{categoryName(ticket.category)}</span><span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">{ticket.priority} priority</span></div>
    <div><h2 className="text-xl font-bold text-fg">{ticket.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{ticket.description}</p></div>
    <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-sunken p-3 text-sm"><div><dt className="text-xs text-fg-subtle">Location</dt><dd className="mt-1 font-medium text-fg">{ticket.location}</dd></div><div><dt className="text-xs text-fg-subtle">Reported by</dt><dd className="mt-1 font-medium text-fg">{ticket.reporter}</dd></div><div><dt className="text-xs text-fg-subtle">Opened</dt><dd className="mt-1 text-fg">{dateLabel(ticket.createdAt)}</dd></div><div><dt className="text-xs text-fg-subtle">Assigned to</dt><dd className="mt-1 text-fg">{ticket.assignee || "Unassigned"}</dd></div>{ticket.incidentId && <div className="col-span-2"><dt className="text-xs text-fg-subtle">Linked simulated incident</dt><dd className="mt-1 font-mono text-xs text-fg">{ticket.incidentId}</dd></div>}</dl>
    {ticket.photos.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-fg">Attached photos <span className="font-normal text-fg-subtle">({ticket.photos.length})</span></h3><div className="flex flex-wrap gap-2">{ticket.photos.map((photo) => <button key={photo.id} type="button" onClick={() => void openPhoto(photo.id)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-fg-muted hover:border-accent/50"><Camera className="size-4" />{photo.filename}</button>)}</div></div>}
    {ticket.comments.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-fg">Updates</h3><ol className="space-y-2 border-l border-border pl-4">{ticket.comments.map((item) => <li key={item.id}><p className="text-sm text-fg">{item.body}</p><p className="mt-1 text-xs text-fg-subtle">{item.author} · {dateLabel(item.createdAt)}</p></li>)}</ol></div>}
    {canManage && <div className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold text-fg">Update ticket</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-fg-muted">Status<select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)} className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm">{TICKET_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{role === "operator" && <label className="text-xs font-medium text-fg-muted">Technician assignment<input value={assignee} onChange={(e) => setAssignee(e.target.value)} maxLength={64} placeholder="Technician username" className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm" /></label>}</div><label className="block text-xs font-medium text-fg-muted">Add an update<textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} placeholder="Work completed, parts needed, next steps…" className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" /></label><Button variant="primary" size="sm" disabled={busy || status === ticket.status && assignee === (ticket.assignee ?? "") && !comment.trim()} onClick={() => void save()}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />} Save update</Button></div>}
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
  const refresh = async () => {
    setError("");
    try { const [meta, items] = await Promise.all([getMaintenanceStatus(), getMaintenanceTickets()]); setStorage(meta); setTickets(items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Maintenance service is unavailable."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0];
  const shown = useMemo(() => filter === "all" ? tickets : tickets.filter((ticket) => ticket.status === filter), [tickets, filter]);
  const counts = useMemo(() => ({ open: tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length, urgent: tickets.filter((ticket) => ticket.priority === "urgent" && !["resolved", "closed"].includes(ticket.status)).length, done: tickets.filter((ticket) => ["resolved", "closed"].includes(ticket.status)).length }), [tickets]);
  const upsert = (ticket: MaintenanceTicket) => { setTickets((existing) => [ticket, ...existing.filter((item) => item.id !== ticket.id)]); setSelectedId(ticket.id); };
  const storageMissing = storage?.storageReady === false;
  const canReport = role === "operator" || role === "viewer";

  return <div className="space-y-6">
    <PageHeader eyebrow="FIELD OPERATIONS" title="Maintenance" description="Report equipment issues, raise repair tickets, and track work through to resolution." actions={<Button size="sm" onClick={() => void refresh()}><RefreshCw /> Refresh</Button>} />
    {storageMissing && <div role="status" className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><span className="mt-0.5 text-amber-600"><AlertTriangle className="size-5" /></span><div><p className="text-sm font-semibold text-fg">Persistent storage needs setup</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-fg-muted">This deployment has no persistent maintenance volume configured. Ticket creation is paused so reports and photos are not lost on restart. Attach a persistent volume and set <code className="rounded bg-surface-sunken px-1">GRIDNOVA_MAINTENANCE_DIR</code> to its mount path to enable the service.</p></div></div>}
    {storage?.demoAccounts && <div className="flex gap-2 rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /><p>Real reports are manually submitted and unverified. Public demo accounts can only submit simulated tickets; private staff accounts are needed for real fault reports.</p></div>}
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}<button onClick={() => void refresh()} aria-label="Retry"><RefreshCw className="size-4" /></button></div>}
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
        <Card padding="md" className="min-h-72">{selected ? <TicketDetail key={selected.id} ticket={selected} role={role} onUpdated={upsert} /> : <div className="grid min-h-64 place-items-center text-center"><div><HardHat className="mx-auto size-8 text-fg-subtle" /><p className="mt-3 font-medium text-fg">Ticket details</p><p className="mt-1 text-sm text-fg-muted">Select a ticket to see updates and repair details.</p></div></div>}</Card>
      </div>
    </div>
    <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><HardHat className="size-3.5" />This page tracks repair reports only; it does not measure faults or control campus equipment.<ArrowUpRight className="size-3.5" /></p>
  </div>;
}
