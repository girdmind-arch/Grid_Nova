import { useEffect, useRef } from "react";
import { CampusSkyline } from "./CampusSkyline";

/**
 * The living background behind every page: a campus power network laid out
 * on the ground, seen in perspective, drifting slowly towards the viewer.
 * Feeders are faint lines, buildings are small rooftops, and short pulses of
 * energy travel along the lines (copper = power, verdigris = agent action).
 *
 * It is decoration only: aria-hidden, no pointer events, paused when the tab
 * is hidden, a single still frame under prefers-reduced-motion, and hidden
 * when printing. Colours come from the theme tokens in tokens.css.
 */

// ---------- deterministic noise so the network is stable while it scrolls ----------
function hash(i: number, j: number, salt = 0) {
  let h = (i * 374761393 + j * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const SPACING_X = 1.25;
const SPACING_Z = 1.1;
const Z_NEAR = 0.55;
const Z_FAR = 24;
const SPEED = 0.11; // world units per second (slow drift)

interface Palette {
  line: string;
  lineAlpha: number;
  pulse: string;
  pulse2: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
  return {
    line: v("--bg-line", "46, 62, 56"),
    lineAlpha: parseFloat(v("--bg-line-alpha", "0.14")),
    pulse: v("--bg-pulse", "176, 92, 32"),
    pulse2: v("--bg-pulse-2", "22, 110, 98"),
  };
}

interface Pulse {
  i: number;
  j: number;
  dir: 0 | 1; // 0 = along x, 1 = along z
  p: number;
  speed: number;
  agent: boolean;
}

// Which edges exist: feeders run mostly along x, some branch along z.
const hasEdgeX = (i: number, j: number) => hash(i, j, 1) < 0.62;
const hasEdgeZ = (i: number, j: number) => hash(i, j, 2) < 0.48;

function nodePos(i: number, j: number) {
  return {
    x: i * SPACING_X + (hash(i, j, 3) - 0.5) * 0.5,
    z: j * SPACING_Z + (hash(i, j, 4) - 0.5) * 0.4,
  };
}

export function GridBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Phones get a still frame: every moving pixel behind the frosted-glass panels forces the
    // browser to re-blur all of them on every frame, which is what made phones lag.
    const lowPower = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
    const reduceMotion = lowPower || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let palette = readPalette();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let travel = 0; // how far the camera has moved forward
    let camX = 0;
    let targetCamX = 0;
    const pulses: Pulse[] = [];

    const resize = () => {
      // Mobile browsers fire resize while the address bar slides in and out: ignore small
      // height-only changes instead of reallocating and redrawing the full-screen canvas.
      if (w && window.innerWidth === w && Math.abs(window.innerHeight - h) < 160) return;
      dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      if (reduceMotion) draw(0);
    };

    // Perspective: horizon at ~34% of the height, ground fills the rest.
    const horizon = () => h * 0.34;
    const focal = () => (h - horizon()) * 0.62;
    const project = (x: number, z: number) => {
      const f = focal();
      return { sx: w / 2 + ((x - camX) * f) / z, sy: horizon() + f / z };
    };
    // Fade in near the viewer and out towards the horizon.
    const depthAlpha = (z: number) => {
      const near = Math.min(1, Math.max(0, (z - Z_NEAR) / 2.0));
      const far = Math.min(1, Math.max(0, (Z_FAR - z) / (Z_FAR * 0.65)));
      return near * far * far;
    };

    const spawnPulse = (): Pulse => {
      const jBase = Math.floor(travel / SPACING_Z);
      for (let tries = 0; tries < 30; tries++) {
        const j = jBase + 2 + Math.floor(Math.random() * 11);
        const halfCols = Math.floor((w / 2 / focal()) * (j * SPACING_Z - travel) / SPACING_X) + 1;
        const i = Math.round(camX / SPACING_X) + Math.floor((Math.random() * 2 - 1) * halfCols * 0.8);
        const dir: 0 | 1 = Math.random() < 0.7 ? 0 : 1;
        if (dir === 0 ? hasEdgeX(i, j) : hasEdgeZ(i, j)) {
          return { i, j, dir, p: 0, speed: 0.35 + Math.random() * 0.45, agent: Math.random() < 0.3 };
        }
      }
      return { i: 0, j: jBase + 5, dir: 0, p: 1, speed: 1, agent: false };
    };

    function draw(dt: number) {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const f = focal();
      const jStart = Math.floor((travel + Z_NEAR) / SPACING_Z) - 1;
      const jEnd = Math.ceil((travel + Z_FAR) / SPACING_Z);

      // ---- feeders (one path per row, so alpha can follow depth) ----
      for (let j = jEnd; j >= jStart; j--) {
        const zRow = j * SPACING_Z - travel;
        if (zRow <= Z_NEAR * 0.6) continue;
        const a = depthAlpha(zRow) * palette.lineAlpha;
        if (a < 0.004) continue;
        const half = Math.ceil(((w / 2) * zRow) / f / SPACING_X) + 2;
        const i0 = Math.floor(camX / SPACING_X) - half;
        const i1 = Math.floor(camX / SPACING_X) + half;

        ctx.beginPath();
        for (let i = i0; i <= i1; i++) {
          const n = nodePos(i, j);
          const p = project(n.x, n.z - travel);
          if (hasEdgeX(i, j)) {
            const m = nodePos(i + 1, j);
            const q = project(m.x, m.z - travel);
            ctx.moveTo(p.sx, p.sy);
            ctx.lineTo(q.sx, q.sy);
          }
          if (hasEdgeZ(i, j)) {
            const m = nodePos(i, j + 1);
            const zz = m.z - travel;
            if (zz > Z_NEAR * 0.5) {
              const q = project(m.x, zz);
              ctx.moveTo(p.sx, p.sy);
              ctx.lineTo(q.sx, q.sy);
            }
          }
        }
        ctx.strokeStyle = `rgba(${palette.line}, ${a})`;
        ctx.lineWidth = Math.max(0.6, Math.min(1.25, 2.2 / zRow));
        ctx.stroke();

        // ---- nodes and rooftops ----
        ctx.fillStyle = `rgba(${palette.line}, ${Math.min(1, a * 2.2)})`;
        ctx.strokeStyle = `rgba(${palette.line}, ${Math.min(1, a * 1.8)})`;
        for (let i = i0; i <= i1; i++) {
          const r = hash(i, j, 5);
          if (r > 0.3) continue;
          const n = nodePos(i, j);
          const z = n.z - travel;
          if (z <= Z_NEAR) continue;
          if (r < 0.055 && z > 2.2) {
            // a building: small square rooftop on the ground plane
            const s = 0.22 + hash(i, j, 6) * 0.18;
            const c1 = project(n.x - s, z - s);
            const c2 = project(n.x + s, z - s);
            const c3 = project(n.x + s, z + s);
            const c4 = project(n.x - s, z + s);
            ctx.beginPath();
            ctx.moveTo(c1.sx, c1.sy);
            ctx.lineTo(c2.sx, c2.sy);
            ctx.lineTo(c3.sx, c3.sy);
            ctx.lineTo(c4.sx, c4.sy);
            ctx.closePath();
            ctx.globalAlpha = 0.35;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.stroke();
          } else {
            const p = project(n.x, z);
            const rad = Math.max(0.7, Math.min(2.4, 2.6 / z));
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ---- energy pulses ----
      for (const pulse of pulses) {
        pulse.p += pulse.speed * dt;
        const a = nodePos(pulse.i, pulse.j);
        const b = pulse.dir === 0 ? nodePos(pulse.i + 1, pulse.j) : nodePos(pulse.i, pulse.j + 1);
        const t = Math.min(1, pulse.p);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t - travel;
        if (z <= Z_NEAR) {
          pulse.p = 2;
          continue;
        }
        const tailT = Math.max(0, t - 0.35);
        const tx = a.x + (b.x - a.x) * tailT;
        const tz = a.z + (b.z - a.z) * tailT - travel;
        const head = project(x, z);
        const tail = project(tx, Math.max(tz, Z_NEAR));
        // fade in and out over the pulse's life
        const life = Math.sin(Math.PI * Math.min(1, pulse.p / 1.15));
        const alpha = depthAlpha(z) * life * 0.85;
        if (alpha < 0.01) continue;
        const color = pulse.agent ? palette.pulse2 : palette.pulse;

        const grad = ctx.createLinearGradient(tail.sx, tail.sy, head.sx, head.sy);
        grad.addColorStop(0, `rgba(${color}, 0)`);
        grad.addColorStop(1, `rgba(${color}, ${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1, Math.min(2.6, 3.2 / z));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tail.sx, tail.sy);
        ctx.lineTo(head.sx, head.sy);
        ctx.stroke();

        const glowR = Math.max(4, Math.min(16, 22 / z));
        const glow = ctx.createRadialGradient(head.sx, head.sy, 0, head.sx, head.sy, glowR);
        glow.addColorStop(0, `rgba(${color}, ${alpha * 0.9})`);
        glow.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.sx, head.sy, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let k = pulses.length - 1; k >= 0; k--) {
        if (pulses[k].p >= 1.15) pulses.splice(k, 1);
      }
    }

    const targetPulses = () => (w < 640 ? 7 : 14);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      if (dt < 1 / 50) return; // ~45 fps is plenty for a background
      last = now;
      travel += SPEED * dt;
      camX += (targetCamX - camX) * Math.min(1, dt * 1.5);
      while (pulses.length < targetPulses() && Math.random() < 0.08) pulses.push(spawnPulse());
      draw(dt);
    };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      targetCamX = ((e.clientX / w) - 0.5) * 0.9; // gentle parallax
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduceMotion) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      if (reduceMotion) draw(0);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });

    resize();
    window.addEventListener("resize", resize);
    if (reduceMotion) {
      // A still frame with a few pulses frozen mid-flight.
      for (let k = 0; k < 8; k++) {
        const p = spawnPulse();
        p.p = 0.5;
        pulses.push(p);
      }
      draw(0);
    } else {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div aria-hidden className="grid-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* ambient light: low copper sun and a verdigris haze, drifting very slowly */}
      <div className="grid-backdrop__glow grid-backdrop__glow--sun" />
      <div className="grid-backdrop__glow grid-backdrop__glow--haze" />
      <div className="grid-backdrop__horizon" />
      <div className="grid-backdrop__sun" />
      <CampusSkyline />
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="grid-backdrop__vignette" />
      <div className="grid-backdrop__grain" />
      <span className="grid-backdrop__bubble" style={{ width: 150, height: 150, top: "60%", left: "80%" }} />
      <span className="grid-backdrop__bubble" style={{ width: 84, height: 84, top: "70%", left: "24%", animationDelay: "-8s" }} />
      <span className="grid-backdrop__bubble" style={{ width: 46, height: 46, top: "44%", left: "5%", animationDelay: "-14s" }} />
    </div>
  );
}
