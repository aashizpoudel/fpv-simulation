export function setupHelpModal(): {
  toggleHelp: () => void;
  closeHelp: () => void;
  dispose: () => void;
} {
  const helpModal = document.getElementById("helpModal");
  const helpToggleBtn = document.getElementById("helpToggleBtn");
  const closeHelpBtn = document.getElementById("closeHelpBtn");
  const toggleHelp = () => {
    if (!helpModal) return;
    const isHidden =
      helpModal.style.display === "none" || !helpModal.style.display;
    helpModal.style.display = isHidden ? "flex" : "none";
  };
  const closeHelp = () => {
    if (helpModal) helpModal.style.display = "none";
  };
  helpToggleBtn?.addEventListener("click", toggleHelp);
  closeHelpBtn?.addEventListener("click", closeHelp);
  helpModal?.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelp();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpModal?.style.display === "flex") {
      closeHelp();
    }
  });
  const dispose = () => {
    helpToggleBtn?.removeEventListener("click", toggleHelp);
    closeHelpBtn?.removeEventListener("click", closeHelp);
  };
  return { toggleHelp, closeHelp, dispose };
}
