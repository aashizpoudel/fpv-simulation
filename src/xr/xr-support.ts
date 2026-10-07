/** Reports whether an immersive VR headset is available, now and when devices change. */
export function subscribeVrSupport(onChange: (supported: boolean) => void): () => void {
  const xr = typeof navigator !== "undefined" ? navigator.xr : undefined;
  if (!xr) {
    onChange(false);
    return () => {};
  }
  let disposed = false;
  let last: boolean | undefined;
  const check = () => {
    xr.isSessionSupported("immersive-vr")
      .catch(() => false)
      .then((supported) => {
        if (disposed || supported === last) return;
        last = supported;
        onChange(supported);
      });
  };
  check();
  xr.addEventListener("devicechange", check);
  return () => {
    disposed = true;
    xr.removeEventListener("devicechange", check);
  };
}

/** Must be called from a user gesture (click). */
export async function requestVrSession(): Promise<XRSession> {
  if (!navigator.xr) throw new Error("WebXR is not available in this browser.");
  // The goggle screen is head-locked, so the always-available "viewer" space is enough.
  return navigator.xr.requestSession("immersive-vr");
}
