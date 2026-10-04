import { getAudioVolume, setAudioVolume } from "../audio/audio-preferences";

export function setupSettingsTabs(): void {
  const root = document.querySelector<HTMLElement>(".flight-help");
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const select = (selected: HTMLButtonElement) => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      if (panel) panel.hidden = !active;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", event => {
      let next: number;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      select(tabs[next]);
      tabs[next].focus();
    });
  });

  const slider = root.querySelector<HTMLInputElement>("#audioVolume");
  const output = root.querySelector<HTMLOutputElement>("#audioVolumeValue");
  if (!slider || !output) return;
  const displayVolume = () => {
    const percent = Number(slider.value);
    output.value = percent === 0 ? "Muted" : `${percent}%`;
    slider.setAttribute("aria-valuetext", percent === 0 ? "Muted" : `${percent}%`);
  };
  slider.value = String(Math.round(getAudioVolume() * 100));
  displayVolume();
  slider.addEventListener("input", () => {
    displayVolume();
    setAudioVolume(Number(slider.value) / 100);
  });
}
