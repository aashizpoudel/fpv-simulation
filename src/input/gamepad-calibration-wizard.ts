import {
  DEFAULT_CALIBRATION,
  type GamepadAxisMapping,
  type GamepadCalibration,
} from "./gamepad-calibration";

type AxisKey = "throttle" | "yaw" | "pitch" | "roll";
type ButtonKey = "arm" | "reset" | "camera" | "mode";

type CalibrationStep =
  | { type: "axis"; key: AxisKey; label: string }
  | { type: "button"; key: ButtonKey; label: string; optional?: boolean };

const STEPS: CalibrationStep[] = [
  { type: "axis", key: "throttle", label: "Move THROTTLE through full range" },
  { type: "axis", key: "yaw", label: "Move YAW left/right" },
  { type: "axis", key: "pitch", label: "Move PITCH up/down" },
  { type: "axis", key: "roll", label: "Move ROLL left/right" },
  { type: "button", key: "arm", label: "Press ARM button" },
  { type: "button", key: "reset", label: "Press RESET button" },
  { type: "button", key: "camera", label: "Press CAMERA button (optional)", optional: true },
  { type: "button", key: "mode", label: "Press MODE button (optional)", optional: true },
];

const AXIS_THRESHOLD = 0.25;
const BUTTON_THRESHOLD = 0.5;

type OverlayElements = {
  overlay: HTMLDivElement;
  title: HTMLHeadingElement;
  body: HTMLParagraphElement;
  status: HTMLParagraphElement;
  next: HTMLButtonElement;
  skip: HTMLButtonElement;
  cancel: HTMLButtonElement;
  defaults: HTMLButtonElement;
};

export function runCalibrationWizard(gamepadIndex: number): Promise<GamepadCalibration> {
  return new Promise((resolve, reject) => {
    const ui = createOverlay();
    let stepIndex = 0;
    let rafId: number | null = null;
    let stopped = false;

    const axisMappings: Partial<Record<AxisKey, GamepadAxisMapping>> = {};
    const buttonMappings: Partial<Record<ButtonKey, number>> = {};
    const usedAxes = new Set<number>();
    const usedButtons = new Set<number>();

    const cleanup = () => {
      stopped = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      ui.overlay.remove();
    };

    const finish = (cal: GamepadCalibration) => {
      cleanup();
      resolve(cal);
    };

    const cancel = (reason: string) => {
      cleanup();
      reject(new Error(reason));
    };

    ui.defaults.onclick = () => {
      const pad = navigator.getGamepads?.()[gamepadIndex];
      finish({ ...DEFAULT_CALIBRATION, gamepadId: pad?.id ?? `gamepad-${gamepadIndex}` });
    };
    ui.cancel.onclick = () => cancel("Calibration cancelled");
    ui.next.onclick = () => advance();
    ui.skip.onclick = () => {
      const step = STEPS[stepIndex];
      if (step.type === "button" && step.optional) advance();
    };

    const advance = () => {
      stepIndex += 1;
      if (stepIndex >= STEPS.length) {
        const pad = navigator.getGamepads?.()[gamepadIndex];
        finish({
          ...DEFAULT_CALIBRATION,
          gamepadId: pad?.id ?? `gamepad-${gamepadIndex}`,
          axes: { ...DEFAULT_CALIBRATION.axes, ...axisMappings },
          buttons: { ...DEFAULT_CALIBRATION.buttons, ...buttonMappings },
        });
        return;
      }
      runStep();
    };

    const runStep = () => {
      const step = STEPS[stepIndex];
      const isOptionalButton = step.type === "button" && step.optional;
      ui.title.textContent = `Step ${stepIndex + 1} of ${STEPS.length}`;
      ui.body.textContent = step.label;
      ui.status.textContent = "Waiting for input...";
      ui.next.disabled = true;
      ui.skip.disabled = !isOptionalButton;
      ui.skip.classList.toggle("hidden", !isOptionalButton);

      if (step.type === "axis") {
        listenForAxis(step.key);
      } else {
        listenForButton(step.key, Boolean(step.optional));
      }
    };

    const listenForAxis = (axisKey: AxisKey) => {
      let baseline: number[] | null = null;

      const sample = () => {
        if (stopped) return;
        const pad = navigator.getGamepads?.()[gamepadIndex];
        if (!pad) {
          ui.status.textContent = "Gamepad not detected. Plug in and move stick.";
          rafId = requestAnimationFrame(sample);
          return;
        }

        if (!baseline) baseline = [...pad.axes];

        let bestIndex = -1;
        let bestDelta = 0;
        let deltaSign = 1;

        for (let i = 0; i < pad.axes.length; i += 1) {
          if (usedAxes.has(i)) continue;
          const delta = pad.axes[i] - (baseline[i] ?? 0);
          const magnitude = Math.abs(delta);
          if (magnitude > bestDelta) {
            bestDelta = magnitude;
            bestIndex = i;
            deltaSign = Math.sign(delta) || 1;
          }
        }

        if (bestIndex >= 0 && bestDelta > AXIS_THRESHOLD) {
          const inverted = deltaSign < 0;
          usedAxes.add(bestIndex);
          axisMappings[axisKey] = { index: bestIndex, inverted };
          ui.status.textContent = `Captured axis ${bestIndex}${inverted ? " (inverted)" : ""}`;
          ui.next.disabled = false;
          return;
        }

        rafId = requestAnimationFrame(sample);
      };

      sample();
    };

    const listenForButton = (buttonKey: ButtonKey, optional: boolean) => {
      const sample = () => {
        if (stopped) return;
        const pad = navigator.getGamepads?.()[gamepadIndex];
        if (!pad) {
          ui.status.textContent = "Gamepad not detected. Plug in and press button.";
          rafId = requestAnimationFrame(sample);
          return;
        }

        let captured = false;

        for (let i = 0; i < pad.buttons.length; i += 1) {
          if (usedButtons.has(i)) continue;
          if (pad.buttons[i]?.value > BUTTON_THRESHOLD || pad.buttons[i]?.pressed) {
            usedButtons.add(i);
            buttonMappings[buttonKey] = i;
            ui.status.textContent = `Captured button ${i}`;
            ui.next.disabled = false;
            captured = true;
            break;
          }
        }

        if (!captured) rafId = requestAnimationFrame(sample);
      };

      if (optional) {
        ui.status.textContent = "Press button to capture or Skip.";
        ui.next.disabled = true;
      }

      sample();
    };

    runStep();
  });
}

function createOverlay(): OverlayElements {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(0,0,0,0.7)";
  overlay.style.zIndex = "9999";
  overlay.style.color = "#f8f8f8";
  overlay.style.fontFamily = "sans-serif";

  const panel = document.createElement("div");
  panel.style.background = "rgba(20,20,20,0.95)";
  panel.style.padding = "24px";
  panel.style.borderRadius = "12px";
  panel.style.width = "min(520px, 90vw)";
  panel.style.boxShadow = "0 8px 32px rgba(0,0,0,0.35)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "12px";

  const title = document.createElement("h2");
  title.textContent = "Gamepad Calibration";
  title.style.margin = "0";

  const body = document.createElement("p");
  body.style.margin = "0";

  const status = document.createElement("p");
  status.style.margin = "0";
  status.style.color = "#9ad1ff";

  const buttons = document.createElement("div");
  buttons.style.display = "flex";
  buttons.style.gap = "8px";
  buttons.style.flexWrap = "wrap";
  buttons.style.justifyContent = "flex-end";

  const makeButton = (label: string) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.padding = "10px 14px";
    btn.style.borderRadius = "8px";
    btn.style.border = "1px solid #444";
    btn.style.background = "#2c2c2c";
    btn.style.color = "#f8f8f8";
    btn.style.cursor = "pointer";
    btn.onmouseenter = () => {
      btn.style.background = "#3a3a3a";
    };
    btn.onmouseleave = () => {
      btn.style.background = "#2c2c2c";
    };
    return btn;
  };

  const next = makeButton("Next");
  next.disabled = true;

  const skip = makeButton("Skip");
  skip.classList.add("hidden");

  const cancel = makeButton("Cancel");
  const defaults = makeButton("Use Defaults");

  buttons.append(defaults, skip, cancel, next);
  panel.append(title, body, status, buttons);
  overlay.append(panel);
  document.body.append(overlay);

  const style = document.createElement("style");
  style.textContent = `.hidden{display:none !important;}`;
  overlay.append(style);

  return { overlay, title, body, status, next, skip, cancel, defaults };
}
