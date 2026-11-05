type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Toggle page fullscreen; the button stays hidden where the Fullscreen API is unavailable (e.g. iPhone Safari). */
export function setupFullscreenButton(doc: Document = document): void {
  const button = doc.getElementById("fullscreenToggleBtn");
  if (!button) return;
  const webkitDoc = doc as WebkitDocument;
  const root = doc.documentElement as WebkitElement;
  const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  const exit = doc.exitFullscreen?.bind(doc) ?? webkitDoc.webkitExitFullscreen?.bind(doc);
  if (!request || !exit || doc.fullscreenEnabled === false) return;

  const active = () => !!(doc.fullscreenElement ?? webkitDoc.webkitFullscreenElement);
  const sync = () => {
    const on = active();
    button.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
    button.title = on ? "Exit fullscreen" : "Fullscreen";
    const enterIcon = button.querySelector<SVGElement>(".fullscreen-enter-icon");
    const exitIcon = button.querySelector<SVGElement>(".fullscreen-exit-icon");
    if (enterIcon) enterIcon.style.display = on ? "none" : "";
    if (exitIcon) exitIcon.style.display = on ? "" : "none";
  };
  button.style.display = "";
  button.addEventListener("click", async () => {
    try {
      await (active() ? exit() : request());
    } catch { /* The browser may refuse fullscreen; the page keeps working. */ }
  });
  doc.addEventListener("fullscreenchange", sync);
  doc.addEventListener("webkitfullscreenchange", sync);
  sync();
}
