/** True when the browser can create a WebGL context (checked once). */
let cached: boolean | null = null;
export function webglAvailable() {
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    cached = !!gl;
    // Release the probe's context straight away: browsers cap how many can be alive.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
