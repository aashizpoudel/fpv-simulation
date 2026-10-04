export function setupPwa(): void {
  // Register service worker in production (or when available)
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      navigator.serviceWorker.register(swUrl).catch((err) => {
        console.warn("PWA ServiceWorker registration failed:", err);
      });
    });
  }

  // Handle in-app install prompt across both welcome screen and HUD toolbar
  const installButtons = [
    document.getElementById("pwaInstallBtn") as HTMLButtonElement | null,
    document.getElementById("welcomeInstallBtn") as HTMLButtonElement | null,
  ].filter((btn): btn is HTMLButtonElement => btn !== null);

  if (installButtons.length === 0) return;

  const isStandalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

  if (isStandalone) {
    installButtons.forEach((btn) => (btn.style.display = "none"));
    return;
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installButtons.forEach((btn) => (btn.style.display = ""));
  });

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    installButtons.forEach((btn) => (btn.style.display = "none"));
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      deferredPrompt = null;
    }
  };

  installButtons.forEach((btn) => btn.addEventListener("click", triggerInstall));

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButtons.forEach((btn) => (btn.style.display = "none"));
  });
}
