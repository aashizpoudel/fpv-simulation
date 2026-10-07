const LOADING_EVENT = "fpv-loading-progress";

type LoadingDetail = { message: string; progress?: number };

/** Renderers call this while assets load; the overlay shows the latest message. */
export function reportLoading(message: string, progress?: number): void {
  window.dispatchEvent(new CustomEvent<LoadingDetail>(LOADING_EVENT, { detail: { message, progress } }));
}

/** Listen to map loading progress (0..1 when known). Returns an unsubscribe function. */
export function subscribeLoading(onProgress: (message: string, progress?: number) => void): () => void {
  const listener = (event: Event) => {
    const { message, progress } = (event as CustomEvent<LoadingDetail>).detail;
    onProgress(message, progress);
  };
  window.addEventListener(LOADING_EVENT, listener);
  return () => window.removeEventListener(LOADING_EVENT, listener);
}

/**
 * Full-screen map loading overlay. It is shown once the pilot presses Play (or
 * after a map change reload) while the map is still loading, and hidden when
 * the app is ready or fails.
 */
export function setupLoadingOverlay(appReady: Promise<unknown>): { show(): void } {
  const overlay = document.getElementById("loadingOverlay");
  const text = document.getElementById("loadingOverlayText");
  const bar = document.getElementById("loadingOverlayBar");
  let settled = false;

  const unsubscribe = subscribeLoading((message, progress) => {
    if (text) text.textContent = message;
    if (bar) {
      bar.parentElement?.classList.toggle("indeterminate", progress === undefined);
      if (progress !== undefined) bar.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
    }
  });

  const finish = () => {
    settled = true;
    if (overlay) overlay.hidden = true;
    unsubscribe();
  };
  appReady.then(finish, finish);

  return {
    show() {
      if (!settled && overlay) overlay.hidden = false;
    },
  };
}
