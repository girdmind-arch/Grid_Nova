import { useEffect, useRef, useState } from "react";
import type { HardwareState } from "@/types/hardware";
import { InfoCard, type Info } from "@/components/grid/grid3d/NodeCard";
import { formatNumber } from "@/utils/format";
import { amps, watts } from "../RigReadings";
import { BRANCH_NODE, RigScene, type Branch } from "./RigScene";

/** A picked part of the rig, in plain words, from the live telemetry. */
function describe(id: string, hw: HardwareState): Info | null {
  const d = hw.device;
  const online = d.status === "online";
  const out = d.readings.output ?? null;
  const branch = (Object.keys(BRANCH_NODE) as Branch[]).find((b) => BRANCH_NODE[b].id === id);
  if (branch) {
    const on = !!d.loads[branch];
    const level = on ? (d.brightness?.[branch] ?? 255) : 0;
    const full = d.model?.branchMa[branch];
    return {
      title: BRANCH_NODE[branch].name,
      kicker: `LED branch · ${branch}`,
      tone: hw.estop.active ? "fault" : on ? "ok" : "warn",
      rows: [
        ["State", hw.estop.active ? "Off (e-stop)" : on ? "On" : "Off"],
        ["PWM duty", `${level}/255 (${Math.round((level * 100) / 255)}%)`],
        ["Draw at full", full !== undefined && d.model?.confident ? `${formatNumber(full)} mA` : "still learning"],
        ["Switch", "MOSFET, 1 kHz PWM"],
      ],
      note: branch === "critical" ? "The critical branch is never switched off by command." : undefined,
    };
  }
  switch (id) {
    case "adapter":
      return {
        title: "Wall adapter",
        kicker: "Main supply · relay NC",
        tone: d.adapter?.present === false ? "fault" : "ok",
        rows: [
          ["Supplying", d.adapter?.present === true ? "Yes" : d.adapter?.present === false ? "No" : "Unknown"],
          ["Sense voltage", d.adapter?.sensed && d.adapter.senseV !== null ? `${d.adapter.senseV.toFixed(2)} V` : "not fitted"],
          ["Selected", d.source === "adapter" ? "Yes" : "No"],
        ],
        note: "Read through a voltage divider on GPIO 34. Unplugging it starts a grid outage on the campus.",
      };
    case "battery":
      return {
        title: "Power bank",
        kicker: "Backup supply · relay NO",
        tone: d.source === "powerbank" ? "ok" : "ai",
        rows: [
          ["Selected", d.source === "powerbank" ? "Yes" : "No"],
          ["Charge", "unknown"],
        ],
        note: "A USB power bank's voltage does not reveal its charge, so none is shown.",
      };
    case "relay":
      return {
        title: "SPDT relay",
        kicker: "Source selector",
        tone: "ok",
        rows: [
          ["Position", d.source === "powerbank" ? "ON · power bank" : d.source === "adapter" ? "OFF · adapter" : "switching"],
          ["Auto-transfer", hw.armed ? "ready (armed)" : "off (not armed)"],
        ],
        note: "While armed, the ESP32 moves to the power bank on its own within about 0.3 s of losing the adapter. Going back is a server command.",
      };
    case "meter":
      return {
        title: "INA219",
        kicker: "Load-rail sensor",
        tone: out ? "ok" : "warn",
        rows: out
          ? [
              ["Voltage", `${out.voltageV.toFixed(2)} V`],
              ["Current", amps(out.currentA)],
              ["Power (V × I)", watts(out.powerW)],
              ["Reading", out.fresh ? "fresh" : "stale"],
            ]
          : [["Reading", "none"]],
        note: "On the relay's COM output, so it measures whichever source is selected.",
      };
    case "esp32":
      return {
        title: "ESP32",
        kicker: "Controller",
        tone: online ? "ok" : "warn",
        rows: [
          ["Status", online ? `online · ${d.ageS !== null ? `${Math.round(d.ageS)} s ago` : "now"}` : d.status === "never_seen" ? "never seen" : "offline"],
          ["Armed", hw.armed ? "yes" : "no"],
          ["Firmware", d.firmware ?? "unknown"],
        ],
        note: "Reports every 2 s over HTTPS, then runs only allow-listed commands.",
      };
    case "estop":
      return {
        title: "Emergency stop",
        kicker: "Safety",
        tone: hw.estop.active ? "fault" : "ok",
        rows: [["State", hw.estop.active ? "latched: every load off" : "ready"]],
        note: "Works without Wi-Fi. Loads stay off after a reset until commanded on.",
      };
  }
  return null;
}

/** React wrapper for the rig's 3D mini campus (lazy loaded, like the campus Grid3D). */
export default function RigGrid3D({ state, height }: { state: HardwareState; height: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RigScene | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new RigScene(host);
    sceneRef.current = scene;
    scene.onPick = setPicked;
    const ro = new ResizeObserver(([entry]) => scene.resize(entry.contentRect.width, entry.contentRect.height));
    ro.observe(host);
    let onScreen = false;
    const sync = () => (onScreen && !document.hidden ? scene.start() : scene.stop());
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(host);
    document.addEventListener("visibilitychange", sync);
    const mo = new MutationObserver(() => scene.applyPalette());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => {
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateRig(state);
  }, [state]);

  const info = picked ? describe(picked, state) : null;
  return (
    <div ref={hostRef} className="grid3d relative w-full overflow-hidden rounded-lg" style={{ height }}>
      {info && <InfoCard info={info} onClose={() => sceneRef.current?.select(null)} />}
    </div>
  );
}
