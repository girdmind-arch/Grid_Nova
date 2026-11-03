// hi
import { useEffect, useState } from "react";
import { CheckCircle2, Download, Share } from "lucide-react";
import { Button } from "@/components/ui";

/** The browser's install prompt event (not in TypeScript's DOM types). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Add to Home Screen: a button where the browser allows it, plain steps on iPhone. */
export function InstallApp() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [offlineReady, setOfflineReady] = useState(() => "serviceWorker" in navigator && !!navigator.serviceWorker.controller);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const onController = () => setOfflineReady(true);
    navigator.serviceWorker?.addEventListener("controllerchange", onController);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      navigator.serviceWorker?.removeEventListener("controllerchange", onController);
    };
  }, []);

  const install = async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setEvent(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 aria-hidden className={`mt-0.5 size-5 shrink-0 ${offlineReady ? "text-success" : "text-fg-subtle"}`} strokeWidth={1.75} />
        <p className="text-[15px] text-fg">
          {offlineReady ? "Ready to work offline. After the first visit the whole app opens without a signal." : "Offline support turns on after the first full load."}
        </p>
      </div>

      {installed ? (
        <p className="text-[15px] font-semibold text-success">Installed on this device.</p>
      ) : event ? (
        <Button variant="primary" onClick={install}>
          <Download aria-hidden strokeWidth={1.75} /> Install GridNova
        </Button>
      ) : isIos() ? (
        <p className="flex items-start gap-2 text-[15px] text-fg">
          <Share aria-hidden className="mt-0.5 size-[18px] shrink-0 text-accent" strokeWidth={1.75} />
          <span>
            In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. GridNova opens full screen like an app.
          </span>
        </p>
      ) : (
        <p className="text-[15px] text-fg-muted">
          Open this page in Chrome or Edge on your phone and use the browser menu, then <strong className="text-fg">Install app</strong> (or{" "}
          <strong className="text-fg">Add to Home screen</strong>).
        </p>
      )}
    </div>
  );
}
