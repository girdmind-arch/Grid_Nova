// hi
// Tiny optional sound cues for scenario demos, made with the Web Audio API
// (no audio files). Off by default; the choice is remembered per browser.

export type Cue = "alarm" | "step" | "resolve" | "attention";

const KEY = "gridnova-sound";
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the toggle still works for this page */
  }
  memo = on;
}

let memo: boolean | null = null;
const isOn = () => (memo ??= soundEnabled());

function tone(freq: number, startS: number, durS: number, gain = 0.06, type: OscillatorType = "sine") {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + startS;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + durS + 0.05);
}

export function play(cue: Cue) {
  if (!isOn()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    return;
  }
  if (cue === "alarm") {
    tone(880, 0, 0.18, 0.07, "triangle");
    tone(660, 0.22, 0.18, 0.07, "triangle");
    tone(880, 0.44, 0.18, 0.07, "triangle");
  } else if (cue === "step") {
    tone(1200, 0, 0.06, 0.025);
  } else if (cue === "attention") {
    tone(740, 0, 0.14, 0.06, "triangle");
    tone(740, 0.2, 0.14, 0.06, "triangle");
  } else {
    tone(523, 0, 0.16, 0.05);
    tone(659, 0.12, 0.16, 0.05);
    tone(784, 0.24, 0.3, 0.05);
  }
}
