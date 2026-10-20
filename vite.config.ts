import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/**
 * Writes dist/sw.js: a small service worker that makes the app installable and
 * usable offline. The file list is generated from the build, so every hashed
 * chunk is cached and old versions are cleaned up on update.
 * Core files (the app shell) are cached at install; the rest (other pages, the
 * 3D chunk, the Latin fonts) is fetched in the background right after.
 */
function serviceWorker(): Plugin {
  return {
    name: "gridnova-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const core = new Set<string>(["index.html", "manifest.webmanifest", "favicon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png"]);
      const later = new Set<string>(["icons/icon-512.png", "icons/maskable-512.png"]);
      const seen = new Set<string>();
      const addEntry = (name: string) => {
        const c = bundle[name];
        if (!c || seen.has(name)) return;
        seen.add(name);
        core.add(name);
        if (c.type === "chunk") {
          c.imports.forEach(addEntry);
          (c.viteMetadata?.importedCss ?? new Set<string>()).forEach((f: string) => core.add(f));
        }
      };
      for (const [name, c] of Object.entries(bundle)) if (c.type === "chunk" && c.isEntry) addEntry(name);
      for (const name of Object.keys(bundle)) {
        if (name.endsWith(".map") || core.has(name)) continue;
        // other-script fonts are fetched only if a page ever needs them
        if (/\.woff2$/.test(name) && !/-latin-wght-/.test(name)) continue;
        later.add(name);
      }
      const files = [...core, ...later].sort();
      const version = createHash("sha1").update(files.join("|")).digest("hex").slice(0, 10);
      const source = SW_SOURCE.replace("__VERSION__", version)
        .replace("__CORE__", JSON.stringify([...core].sort()))
        .replace("__LATER__", JSON.stringify([...later].sort()));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

const SW_SOURCE = `/* GridNova service worker (generated at build time) */
const VERSION = "__VERSION__";
const CACHE = "gridnova-" + VERSION;
const CORE = __CORE__;
const LATER = __LATER__;
const scope = self.registration.scope;
const url = (f) => new URL(f, scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE.map(url))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("gridnova-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
      // Warm the rest in the background so every page works offline. Failures are fine.
      const c = await caches.open(CACHE);
      await Promise.all(LATER.map((f) => c.add(url(f)).catch(() => {})));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return; // API calls and anything cross-origin go straight to the network
  if (!u.pathname.startsWith(new URL(scope).pathname)) return;

  if (req.mode === "navigate") {
    // Always the app shell: network first (fresh deploys), cached copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(url("index.html"), res.clone()));
          return res;
        })
        .catch(() => caches.match(url("index.html")).then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build files never change: cache first. Everything else: cached copy now, refreshed in the background.
  const hashed = u.pathname.includes("/assets/");
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit && hashed) return hit;
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      });
      if (hit) {
        net.catch(() => {});
        return hit;
      }
      return net.catch(() => Response.error());
    }),
  );
});
`;

export default defineConfig({
  // Served from the domain root by default. GitHub Pages serves this repo at
  // /Grid_Nova/, so the Pages workflow sets BASE_PATH=/Grid_Nova/.
  base: process.env.BASE_PATH || "/",
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    rolldownOptions: {
      output: {
        // Split big libraries into their own files so browsers cache them
        // separately from our code (which changes more often).
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: "motion", test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: "radix", test: /node_modules[\\/]@radix-ui[\\/]/ },
          ],
        },
      },
    },
  },
});
