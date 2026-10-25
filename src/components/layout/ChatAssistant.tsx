import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { askGridNova } from "@/services";
import { cn } from "@/utils/cn";

type ChatLine = { role: "user" | "assistant"; content: string };

const starters = [
  "What's happening on the grid right now?",
  "Explain the battery status.",
  "What can the agents do?",
];

/** A read-only Q&A helper available from every Control Room page. */
export function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [open, messages, busy, error]);

  async function send(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }].slice(-10);
    setMessages(next);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const reply = await askGridNova(next);
      setMessages((current) => [...current, { role: "assistant" as const, content: reply }].slice(-10));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not reply. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden fixed bottom-[calc(var(--bottomnav-h)+20px+env(safe-area-inset-bottom))] right-4 z-50 lg:bottom-6 lg:right-6">
      {open && (
        <section
          aria-label="GridNova Assistant"
          className="mb-3 flex h-[min(620px,calc(100dvh-132px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-glass-border bg-surface-solid shadow-2xl"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-on-accent">
                <Bot aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">GridNova Assistant</h2>
                <p className="text-xs text-fg-muted">Ask about your simulated campus</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="pt-2">
                <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ai/10 text-ai">
                  <Sparkles aria-hidden className="size-5" />
                </div>
                <p className="text-sm font-semibold text-fg">What would you like to know?</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                  I can explain live campus readings, agent roles, forecasts and past decisions.
                </p>
                <div className="mt-5 space-y-2">
                  {starters.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={busy}
                      onClick={() => void send(starter)}
                      className="block w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-xs leading-relaxed text-fg transition hover:border-accent/40 hover:bg-surface-raised disabled:opacity-50"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={`${index}-${message.role}`} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <p
                    className={cn(
                      "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      message.role === "user" ? "rounded-br-md bg-accent text-on-accent" : "rounded-bl-md bg-surface-raised text-fg",
                    )}
                  >
                    {message.content}
                  </p>
                </div>
              ))
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-fg-muted" role="status">
                <LoaderCircle aria-hidden className="size-4 animate-spin text-accent" /> Thinking…
              </div>
            )}
            {error && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">{error}</p>}
          </div>

          <div className="border-t border-border px-3 pb-3 pt-2">
            <form
              className="flex items-end gap-2 rounded-xl border border-border bg-surface px-2 py-2 focus-within:border-accent/60"
              onSubmit={(event) => { event.preventDefault(); void send(); }}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                maxLength={2000}
                rows={1}
                aria-label="Message GridNova Assistant"
                placeholder="Ask a question…"
                className="max-h-24 min-h-9 flex-1 resize-y bg-transparent px-1 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
              />
              <button
                type="submit"
                disabled={!draft.trim() || busy}
                aria-label="Send message"
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-fg-muted">
              Messages go to your self-hosted GridNova model. Don’t include passwords, API keys or personal data. Answers are read-only; campus readings are simulated.
            </p>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close GridNova Assistant" : "Open GridNova Assistant"}
        aria-expanded={open}
        className="ml-auto flex h-12 items-center gap-2 rounded-full border border-glass-border bg-accent px-4 text-sm font-semibold text-on-accent shadow-lg transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-focus-ring"
        style={{ boxShadow: "var(--shadow-md)" }}
      >
        {open ? <X aria-hidden className="size-4" /> : <MessageCircle aria-hidden className="size-4" />}
        {open ? "Close" : "Ask GridNova"}
      </button>
    </div>
  );
}
