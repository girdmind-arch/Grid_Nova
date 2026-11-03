// hi
// Opens the browser's print dialog, where "Save as PDF" makes a vector PDF
// (sharp charts, selectable text) with no extra library.
// For the printout it switches to the light theme and expands every
// "Show as table" so the PDF carries the numbers, then puts both back.

export function printPage() {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  const closed = [...document.querySelectorAll<HTMLDetailsElement>("main details:not([open])")];

  root.dataset.theme = "light";
  closed.forEach((d) => (d.open = true));

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (theme) root.dataset.theme = theme;
    closed.forEach((d) => (d.open = false));
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  // Give the browser one frame to repaint in light before it snapshots the page.
  requestAnimationFrame(() => {
    window.print();
    // Some browsers return from print() before afterprint fires; restore anyway.
    window.setTimeout(restore, 500);
  });
}
