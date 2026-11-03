// hi
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled locally so the demo works without internet.
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";
import App from "./App";
import { registerServiceWorker } from "./pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
