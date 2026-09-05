import {
  DEFAULT_CALIBRATION,
  CALIBRATION_PRESETS,
  loadCalibration,
  isBindingPressed,
  serializeButtonBinding,
  parseButtonBinding,
  formatButtonBinding,
  type GamepadAxisMapping,
  type GamepadButtonBinding,
  type GamepadCalibration,
} from "./gamepad-calibration";

type AxisKey = "throttle" | "yaw" | "pitch" | "roll";
type ButtonKey = "arm" | "reset" | "mode" | "camera";

type WizardStep = {
  axisKey?: AxisKey;
  buttonKey?: ButtonKey;
  instruction: string;
  targetGimbal?: "left" | "right";
  targetPos?: { x: number; y: number }; // 0 to 1
};

const WIZARD_STEPS: WizardStep[] = [
  {
    axisKey: "throttle",
    instruction: "Push THROTTLE fully DOWN, then UP",
    targetGimbal: "left",
    targetPos: { x: 0.5, y: 0.1 },
  },
  {
    axisKey: "yaw",
    instruction: "From center, push YAW LEFT",
    targetGimbal: "left",
    targetPos: { x: 0.1, y: 0.5 },
  },
  {
    axisKey: "pitch",
    instruction: "From center, push PITCH FORWARD (UP)",
    targetGimbal: "right",
    targetPos: { x: 0.5, y: 0.1 },
  },
  {
    axisKey: "roll",
    instruction: "From center, push ROLL RIGHT",
    targetGimbal: "right",
    targetPos: { x: 0.9, y: 0.5 },
  },
  {
    buttonKey: "arm",
    instruction: "Toggle or press your ARM switch / button",
  },
  {
    buttonKey: "reset",
    instruction: "Toggle or press your RESET switch / button",
  },
];

export function runCalibrationWizard(
  gamepadIndex: number,
): Promise<GamepadCalibration> {
  return new Promise((resolve, reject) => {
    // 1. Initial calibration state (load existing if available, else default)
    let activePadIndex = gamepadIndex;
    const initialPad = navigator.getGamepads?.()[gamepadIndex];
    const initialId = initialPad?.id ?? `gamepad-${gamepadIndex}`;
    const loaded = loadCalibration(initialId);

    const calibration: GamepadCalibration = loaded
      ? structuredClone(loaded)
      : {
          ...structuredClone(DEFAULT_CALIBRATION),
          gamepadId: initialId,
        };

    let stopped = false;
    let rafId: number | null = null;
    let detectingAxis: AxisKey | null = null;
    let detectingButton: ButtonKey | null = null;
    let axisBaseline: number[] | null = null;
    let buttonBaseline: boolean[] | null = null;

    // Guided wizard state
    let wizardActive = false;
    let wizardStep = 0;
    let wizardConfirmedTimer: number | null = null;

    // 2. Build DOM
    const overlay = document.createElement("div");
    overlay.className = "cal-overlay";

    const modal = document.createElement("div");
    modal.className = "cal-modal";
    overlay.appendChild(modal);

    modal.innerHTML = `
      <div class="cal-header">
        <div class="cal-header-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="12" x2="10" y2="12"></line>
            <line x1="8" y1="10" x2="8" y2="14"></line>
            <circle cx="15" cy="13" r="1" fill="currentColor"></circle>
            <circle cx="18" cy="11" r="1" fill="currentColor"></circle>
            <rect x="2" y="6" width="20" height="12" rx="6"></rect>
          </svg>
          <h3>Controller Setup &amp; Live Test</h3>
        </div>
        <div class="cal-status-badge disconnected" id="calStatusBadge">
          <span class="cal-status-dot"></span>
          <span id="calStatusText">Scanning controllers…</span>
        </div>
        <button id="calCloseBtn" class="settings-close-btn" type="button" aria-label="Close">✕</button>
      </div>

      <!-- Guided wizard banner (hidden by default) -->
      <div class="cal-wizard-banner" id="calWizardBanner" style="display: none;">
        <div class="cal-wizard-banner-text">
          <span class="cal-wizard-step-tag" id="calWizardStepTag">STEP 1/6</span>
          <span id="calWizardInstruction">Push Throttle fully DOWN, then UP</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="cal-preset-btn" id="calWizardSkipBtn">Skip</button>
          <button type="button" class="cal-preset-btn" id="calWizardExitBtn">Exit Wizard</button>
        </div>
      </div>

      <!-- Duplicate axis warning -->
      <div class="cal-duplicate-warning" id="calDuplicateWarn" style="display: none;"></div>

      <!-- Dual Gimbals Display -->
      <div class="cal-gimbals-row">
        <div class="cal-gimbal-card">
          <div class="cal-gimbal-title">Left Gimbal (Throttle / Yaw)</div>
          <div class="gimbal-box" id="leftGimbalBox">
            <div class="gimbal-crosshair-h"></div>
            <div class="gimbal-crosshair-v"></div>
            <div class="gimbal-center-ring"></div>
            <div class="gimbal-stick-dot" id="leftStickDot" style="left: 50%; top: 50%;"></div>
            <div class="gimbal-target-ring" id="leftTargetRing" style="display: none;"></div>
          </div>
          <div class="cal-gimbal-readouts">
            <span>THR: <b id="valThrottle">0%</b></span>
            <span>YAW: <b id="valYaw">0%</b></span>
          </div>
        </div>

        <div class="cal-gimbal-card">
          <div class="cal-gimbal-title">Right Gimbal (Pitch / Roll)</div>
          <div class="gimbal-box" id="rightGimbalBox">
            <div class="gimbal-crosshair-h"></div>
            <div class="gimbal-crosshair-v"></div>
            <div class="gimbal-center-ring"></div>
            <div class="gimbal-stick-dot" id="rightStickDot" style="left: 50%; top: 50%;"></div>
            <div class="gimbal-target-ring" id="rightTargetRing" style="display: none;"></div>
          </div>
          <div class="cal-gimbal-readouts">
            <span>PIT: <b id="valPitch">0%</b></span>
            <span>ROL: <b id="valRoll">0%</b></span>
          </div>
        </div>
      </div>

      <!-- Channels table -->
      <div class="cal-channels-table">
        <div class="cal-channel-row" id="rowThrottle">
          <span class="cal-channel-name">Throttle</span>
          <div class="cal-meter-track">
            <div class="cal-meter-fill" id="meterThrottle" style="width: 0%;"></div>
          </div>
          <span class="cal-channel-val" id="numThrottle">0%</span>
          <select class="cal-select" id="selThrottle"></select>
          <button type="button" class="cal-toggle-btn" id="invThrottle">⇄ Invert</button>
          <button type="button" class="cal-detect-btn" id="detThrottle">Detect</button>
        </div>

        <div class="cal-channel-row" id="rowYaw">
          <span class="cal-channel-name">Yaw</span>
          <div class="cal-meter-track">
            <div class="cal-meter-center-line"></div>
            <div class="cal-meter-fill" id="meterYaw" style="left: 50%; width: 0%;"></div>
          </div>
          <span class="cal-channel-val" id="numYaw">0%</span>
          <select class="cal-select" id="selYaw"></select>
          <button type="button" class="cal-toggle-btn" id="invYaw">⇄ Invert</button>
          <button type="button" class="cal-detect-btn" id="detYaw">Detect</button>
        </div>

        <div class="cal-channel-row" id="rowPitch">
          <span class="cal-channel-name">Pitch</span>
          <div class="cal-meter-track">
            <div class="cal-meter-center-line"></div>
            <div class="cal-meter-fill" id="meterPitch" style="left: 50%; width: 0%;"></div>
          </div>
          <span class="cal-channel-val" id="numPitch">0%</span>
          <select class="cal-select" id="selPitch"></select>
          <button type="button" class="cal-toggle-btn" id="invPitch">⇄ Invert</button>
          <button type="button" class="cal-detect-btn" id="detPitch">Detect</button>
        </div>

        <div class="cal-channel-row" id="rowRoll">
          <span class="cal-channel-name">Roll</span>
          <div class="cal-meter-track">
            <div class="cal-meter-center-line"></div>
            <div class="cal-meter-fill" id="meterRoll" style="left: 50%; width: 0%;"></div>
          </div>
          <span class="cal-channel-val" id="numRoll">0%</span>
          <select class="cal-select" id="selRoll"></select>
          <button type="button" class="cal-toggle-btn" id="invRoll">⇄ Invert</button>
          <button type="button" class="cal-detect-btn" id="detRoll">Detect</button>
        </div>
      </div>

      <!-- Buttons mapping & live monitor -->
      <div class="cal-buttons-section">
        <div class="cal-buttons-row">
          <div class="cal-button-card" id="cardArm">
            <div>
              <span class="cal-button-name">ARM</span>
              <select class="cal-select" id="selArm"></select>
            </div>
            <button type="button" class="cal-detect-btn" id="detArm">Detect</button>
          </div>

          <div class="cal-button-card" id="cardReset">
            <div>
              <span class="cal-button-name">RESET</span>
              <select class="cal-select" id="selReset"></select>
            </div>
            <button type="button" class="cal-detect-btn" id="detReset">Detect</button>
          </div>

          <div class="cal-button-card" id="cardMode">
            <div>
              <span class="cal-button-name">MODE</span>
              <select class="cal-select" id="selMode"></select>
            </div>
            <button type="button" class="cal-detect-btn" id="detMode">Detect</button>
          </div>

          <div class="cal-button-card" id="cardCamera">
            <div>
              <span class="cal-button-name">CAMERA</span>
              <select class="cal-select" id="selCamera"></select>
            </div>
            <button type="button" class="cal-detect-btn" id="detCamera">Detect</button>
          </div>
        </div>

        <div class="cal-raw-matrix">
          <span>Active Buttons:</span>
          <div id="calBtnMatrix" style="display:flex; gap:4px; flex-wrap:wrap;"></div>
        </div>

        <div class="cal-raw-matrix">
          <span>Raw Controller Axes:</span>
          <div id="calRawAxes" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
        </div>
      </div>

      <!-- Quick Presets & Wizard trigger -->
      <div class="cal-presets-bar">
        <div class="cal-presets-group">
          <span style="font-size: 11px; color:#8bb3cf;">Presets:</span>
          <button type="button" class="cal-preset-btn" id="presetEmax">📻 EMAX Radio</button>
          <button type="button" class="cal-preset-btn" id="presetRadio">📻 FPV Radio (Mode 2)</button>
          <button type="button" class="cal-preset-btn" id="presetGamepad">🎮 Xbox / Gamepad</button>
          <button type="button" class="cal-preset-btn" id="presetDefault">↺ Defaults</button>
        </div>
        <button type="button" class="cal-wizard-launch-btn" id="launchWizardBtn">✨ Run Guided Wizard</button>
      </div>

      <!-- Footer Actions -->
      <div class="cal-footer">
        <div style="display: flex; gap: 8px;">
          <button type="button" class="cal-cancel-btn" id="calCancelBtn">Cancel</button>
          <button type="button" class="cal-preset-btn" id="calSwitchKeyboardBtn">⌨ Switch to Keyboard</button>
        </div>
        <button type="button" class="cal-save-btn" id="calSaveBtn">Save &amp; Fly</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // 3. Helper references
    const el = <T extends HTMLElement>(id: string) =>
      modal.querySelector<T>(`#${id}`)!;
    const statusBadge = el("calStatusBadge");
    const statusText = el("calStatusText");
    const leftStickDot = el("leftStickDot");
    const rightStickDot = el("rightStickDot");
    const leftTargetRing = el("leftTargetRing");
    const rightTargetRing = el("rightTargetRing");

    const valThrottle = el("valThrottle");
    const valYaw = el("valYaw");
    const valPitch = el("valPitch");
    const valRoll = el("valRoll");

    const meterThrottle = el("meterThrottle");
    const meterYaw = el("meterYaw");
    const meterPitch = el("meterPitch");
    const meterRoll = el("meterRoll");

    const numThrottle = el("numThrottle");
    const numYaw = el("numYaw");
    const numPitch = el("numPitch");
    const numRoll = el("numRoll");

    const btnMatrix = el("calBtnMatrix");
    for (let i = 0; i < 16; i++) {
      const chip = document.createElement("div");
      chip.className = "cal-btn-chip";
      chip.id = `btnChip_${i}`;
      chip.textContent = String(i);
      btnMatrix.appendChild(chip);
    }

    const AXES: AxisKey[] = ["throttle", "yaw", "pitch", "roll"];
    const BUTTONS: ButtonKey[] = ["arm", "reset", "mode", "camera"];

    const populateAxisSelectors = (numAxes: number) => {
      const count = Math.max(4, numAxes);
      for (const axis of AXES) {
        const sel = el<HTMLSelectElement>(
          `sel${axis.charAt(0).toUpperCase() + axis.slice(1)}`,
        );
        sel.innerHTML = "";
        for (let i = 0; i < count; i++) {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = `Axis ${i}`;
          sel.appendChild(opt);
        }
      }
    };
    populateAxisSelectors(4);

    const populateButtonSelectors = (
      numButtons: number,
      numAxes: number,
    ) => {
      const btnCount = Math.max(8, numButtons);
      const axisCount = Math.max(6, numAxes);
      for (const btn of BUTTONS) {
        const cap = btn.charAt(0).toUpperCase() + btn.slice(1);
        const sel = el<HTMLSelectElement>(`sel${cap}`);
        if (!sel) continue;
        sel.innerHTML = "";

        const optNone = document.createElement("option");
        optNone.value = "none";
        optNone.textContent = "None";
        sel.appendChild(optNone);

        // Axis Switches (RC Aux channels like A4, A5)
        const optGroupAxes = document.createElement("optgroup");
        optGroupAxes.label = "Axis Switches (RC Aux)";
        for (let a = 0; a < axisCount; a++) {
          const optPos = document.createElement("option");
          optPos.value = `axis:${a}:pos`;
          optPos.textContent = `Axis ${a} (+)`;
          const optNeg = document.createElement("option");
          optNeg.value = `axis:${a}:neg`;
          optNeg.textContent = `Axis ${a} (-)`;
          optGroupAxes.appendChild(optPos);
          optGroupAxes.appendChild(optNeg);
        }
        sel.appendChild(optGroupAxes);

        // Digital Buttons
        const optGroupBtns = document.createElement("optgroup");
        optGroupBtns.label = "Digital Buttons";
        for (let b = 0; b < btnCount; b++) {
          const opt = document.createElement("option");
          opt.value = `btn:${b}`;
          opt.textContent = `Btn ${b}`;
          optGroupBtns.appendChild(opt);
        }
        sel.appendChild(optGroupBtns);
      }
    };
    populateButtonSelectors(8, 6);

    const syncUIFromCalibration = () => {
      for (const axis of AXES) {
        const cap = axis.charAt(0).toUpperCase() + axis.slice(1);
        const sel = el<HTMLSelectElement>(`sel${cap}`);
        const inv = el<HTMLButtonElement>(`inv${cap}`);
        const map = calibration.axes[axis];
        if (sel) sel.value = String(map.index);
        if (inv) inv.classList.toggle("active", map.inverted);
      }

      for (const btn of BUTTONS) {
        const cap = btn.charAt(0).toUpperCase() + btn.slice(1);
        const sel = el<HTMLSelectElement>(`sel${cap}`);
        if (sel) {
          sel.value = serializeButtonBinding(calibration.buttons[btn]);
        }
      }

      // Check for duplicate axis assignments
      const usedMap = new Map<number, string[]>();
      for (const axis of AXES) {
        const idx = calibration.axes[axis].index;
        if (!usedMap.has(idx)) usedMap.set(idx, []);
        usedMap.get(idx)!.push(axis.toUpperCase());
      }
      const duplicates: string[] = [];
      for (const [idx, axesList] of usedMap.entries()) {
        if (axesList.length > 1) {
          duplicates.push(`Axis ${idx} is assigned to both ${axesList.join(" & ")}`);
        }
      }

      // Check for duplicate button assignments
      const usedBindings = new Map<string, string[]>();
      for (const btn of BUTTONS) {
        const b = calibration.buttons[btn];
        const key = serializeButtonBinding(b);
        if (key !== "none") {
          if (!usedBindings.has(key)) usedBindings.set(key, []);
          usedBindings.get(key)!.push(btn.toUpperCase());
        }
      }
      for (const [key, btnList] of usedBindings.entries()) {
        if (btnList.length > 1) {
          const formatted = formatButtonBinding(parseButtonBinding(key));
          duplicates.push(`${formatted} is assigned to both ${btnList.join(" & ")}`);
        }
      }

      const warnEl = el("calDuplicateWarn");
      if (warnEl) {
        if (duplicates.length > 0) {
          warnEl.style.display = "block";
          warnEl.textContent = `⚠️ Duplicate Conflict: ${duplicates.join("; ")}. This causes one switch/stick to trigger multiple actions simultaneously!`;
        } else {
          warnEl.style.display = "none";
        }
      }
    };
    syncUIFromCalibration();

    // 4. Invert & Select Event Handlers
    for (const axis of AXES) {
      const cap = axis.charAt(0).toUpperCase() + axis.slice(1);
      const sel = el<HTMLSelectElement>(`sel${cap}`);
      const inv = el<HTMLButtonElement>(`inv${cap}`);
      const det = el<HTMLButtonElement>(`det${cap}`);

      sel.addEventListener("change", () => {
        calibration.axes[axis].index = Number(sel.value);
      });

      inv.addEventListener("click", () => {
        calibration.axes[axis].inverted = !calibration.axes[axis].inverted;
        inv.classList.toggle("active", calibration.axes[axis].inverted);
      });

      det.addEventListener("click", () => {
        if (detectingAxis === axis) {
          detectingAxis = null;
          det.classList.remove("detecting");
          det.textContent = "Detect";
        } else {
          detectingAxis = axis;
          detectingButton = null;
          axisBaseline = null;
          // Clear other detect buttons
          modal
            .querySelectorAll(".cal-detect-btn")
            .forEach((b) => b.classList.remove("detecting"));
          det.classList.add("detecting");
          det.textContent = "Move…";
        }
      });
    }

    // 5. Button Select & Detect Handlers
    for (const btn of BUTTONS) {
      const cap = btn.charAt(0).toUpperCase() + btn.slice(1);
      const sel = el<HTMLSelectElement>(`sel${cap}`);
      const det = el<HTMLButtonElement>(`det${cap}`);

      sel?.addEventListener("change", () => {
        const parsed = parseButtonBinding(sel.value);
        if (parsed !== undefined) {
          calibration.buttons[btn] = parsed;
        } else {
          delete calibration.buttons[btn];
        }
        syncUIFromCalibration();
      });

      det.addEventListener("click", () => {
        if (detectingButton === btn) {
          detectingButton = null;
          buttonBaseline = null;
          axisBaseline = null;
          det.classList.remove("detecting");
          det.textContent = "Detect";
        } else {
          detectingButton = btn;
          detectingAxis = null;
          buttonBaseline = null;
          axisBaseline = null;
          modal
            .querySelectorAll(".cal-detect-btn")
            .forEach((b) => b.classList.remove("detecting"));
          det.classList.add("detecting");
          det.textContent = "Flick/Press…";
        }
      });
    }

    // 6. Presets
    el("presetEmax")?.addEventListener("click", () => {
      Object.assign(
        calibration.axes,
        CALIBRATION_PRESETS.emaxRadio.calibration.axes,
      );
      Object.assign(
        calibration.buttons,
        CALIBRATION_PRESETS.emaxRadio.calibration.buttons,
      );
      syncUIFromCalibration();
    });
    el("presetRadio").addEventListener("click", () => {
      Object.assign(
        calibration.axes,
        CALIBRATION_PRESETS.fpvRadioMode2.calibration.axes,
      );
      Object.assign(
        calibration.buttons,
        CALIBRATION_PRESETS.fpvRadioMode2.calibration.buttons,
      );
      syncUIFromCalibration();
    });

    el("presetGamepad").addEventListener("click", () => {
      Object.assign(
        calibration.axes,
        CALIBRATION_PRESETS.standardGamepad.calibration.axes,
      );
      Object.assign(
        calibration.buttons,
        CALIBRATION_PRESETS.standardGamepad.calibration.buttons,
      );
      syncUIFromCalibration();
    });

    el("presetDefault").addEventListener("click", () => {
      Object.assign(calibration.axes, DEFAULT_CALIBRATION.axes);
      Object.assign(calibration.buttons, DEFAULT_CALIBRATION.buttons);
      syncUIFromCalibration();
    });

    // 7. Guided Wizard Logic
    const wizardBanner = el("calWizardBanner");
    const wizardStepTag = el("calWizardStepTag");
    const wizardInstruction = el("calWizardInstruction");

    const startWizard = () => {
      wizardActive = true;
      wizardStep = 0;
      wizardBanner.style.display = "flex";
      setupWizardStep();
    };

    const exitWizard = () => {
      wizardActive = false;
      wizardBanner.style.display = "none";
      leftTargetRing.style.display = "none";
      rightTargetRing.style.display = "none";
      detectingAxis = null;
      detectingButton = null;
      axisBaseline = null;
      modal.querySelectorAll(".cal-detect-btn").forEach((b) => {
        b.classList.remove("detecting");
        b.textContent = "Detect";
      });
    };

    const setupWizardStep = () => {
      axisBaseline = null;
      buttonBaseline = null;
      if (wizardStep >= WIZARD_STEPS.length) {
        exitWizard();
        return;
      }
      const step = WIZARD_STEPS[wizardStep];
      wizardStepTag.textContent = `STEP ${wizardStep + 1}/${WIZARD_STEPS.length}`;
      wizardInstruction.textContent = step.instruction;
      axisBaseline = null;

      leftTargetRing.style.display = "none";
      rightTargetRing.style.display = "none";

      if (step.targetGimbal === "left" && step.targetPos) {
        leftTargetRing.style.display = "block";
        leftTargetRing.style.left = `${step.targetPos.x * 100}%`;
        leftTargetRing.style.top = `${step.targetPos.y * 100}%`;
      } else if (step.targetGimbal === "right" && step.targetPos) {
        rightTargetRing.style.display = "block";
        rightTargetRing.style.left = `${step.targetPos.x * 100}%`;
        rightTargetRing.style.top = `${step.targetPos.y * 100}%`;
      }
    };

    el("launchWizardBtn").addEventListener("click", startWizard);
    el("calWizardExitBtn").addEventListener("click", exitWizard);
    el("calWizardSkipBtn").addEventListener("click", () => {
      wizardStep++;
      setupWizardStep();
    });

    // 8. Lifecycle: Close, Save, Cancel
    const cleanup = () => {
      stopped = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (wizardConfirmedTimer != null) clearTimeout(wizardConfirmedTimer);
      overlay.remove();
    };

    const saveAndClose = () => {
      cleanup();
      resolve(calibration);
    };

    const cancelAndClose = () => {
      cleanup();
      reject(new Error("Calibration cancelled"));
    };

    const switchToKeyboardAndClose = () => {
      cleanup();
      reject(new Error("SWITCH_TO_KEYBOARD"));
    };

    el("calSaveBtn").addEventListener("click", saveAndClose);
    el("calCancelBtn").addEventListener("click", cancelAndClose);
    el("calCloseBtn").addEventListener("click", cancelAndClose);
    el("calSwitchKeyboardBtn")?.addEventListener(
      "click",
      switchToKeyboardAndClose,
    );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelAndClose();
    };
    window.addEventListener("keydown", onKeyDown);

    // 9. Main 60 FPS Sampling & Animation Loop
    let lastPadAxisCount = 0;
    let lastPadButtonCount = 0;

    const sample = () => {
      if (stopped) return;

      const pads = navigator.getGamepads?.();
      let pad: Gamepad | null = null;

      // Find active gamepad
      if (pads) {
        if (pads[activePadIndex]) {
          pad = pads[activePadIndex];
        } else {
          for (let i = 0; i < pads.length; i++) {
            if (pads[i]) {
              pad = pads[i];
              activePadIndex = i;
              break;
            }
          }
        }
      }

      if (!pad) {
        statusBadge.className = "cal-status-badge disconnected";
        statusText.textContent = "No Gamepad detected. Connect & move a stick.";
        rafId = requestAnimationFrame(sample);
        return;
      }

      // Update connected badge
      calibration.gamepadId = pad.id || `gamepad-${activePadIndex}`;
      statusBadge.className = "cal-status-badge connected";
      const shortName = pad.id.length > 32 ? `${pad.id.slice(0, 30)}…` : pad.id;
      statusText.textContent = `${shortName} (${pad.axes.length} axes, ${pad.buttons.length} buttons)`;

      if (pad.axes.length !== lastPadAxisCount) {
        lastPadAxisCount = pad.axes.length;
        populateAxisSelectors(pad.axes.length);
        populateButtonSelectors(pad.buttons.length, pad.axes.length);
        syncUIFromCalibration();
      }

      if (pad.buttons.length !== lastPadButtonCount) {
        lastPadButtonCount = pad.buttons.length;
        populateButtonSelectors(pad.buttons.length, pad.axes.length);
        if (btnMatrix) {
          btnMatrix.innerHTML = "";
          for (let i = 0; i < pad.buttons.length; i++) {
            const chip = document.createElement("div");
            chip.className = "cal-btn-chip";
            chip.id = `btnChip_${i}`;
            chip.textContent = String(i);
            btnMatrix.appendChild(chip);
          }
        }
        syncUIFromCalibration();
      }

      // Update raw controller axes readout
      const rawAxesEl = el("calRawAxes");
      if (rawAxesEl) {
        let html = "";
        for (let i = 0; i < pad.axes.length; i++) {
          const val = pad.axes[i] ?? 0;
          const isDeflected = Math.abs(val) > 0.08;
          html += `<span class="cal-axis-chip ${isDeflected ? "active" : ""}">A${i}: ${val >= 0 ? "+" : ""}${val.toFixed(2)}</span>`;
        }
        rawAxesEl.innerHTML = html;
      }

      // Raw button illumination
      for (let i = 0; i < 16; i++) {
        const chip = el(`btnChip_${i}`);
        if (chip) {
          const pressed = Boolean(pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.4);
          chip.classList.toggle("active", pressed);
        }
      }

      // Assigned button / switch states (supports both buttons and axes as buttons)
      el("cardArm").classList.toggle(
        "pressed",
        isBindingPressed(calibration.buttons.arm, pad.buttons, pad.axes),
      );
      el("cardReset").classList.toggle(
        "pressed",
        isBindingPressed(calibration.buttons.reset, pad.buttons, pad.axes),
      );
      el("cardMode").classList.toggle(
        "pressed",
        isBindingPressed(calibration.buttons.mode, pad.buttons, pad.axes),
      );
      el("cardCamera").classList.toggle(
        "pressed",
        isBindingPressed(calibration.buttons.camera, pad.buttons, pad.axes),
      );

      // Live Axis Reading
      const getVal = (m: GamepadAxisMapping) => {
        const raw = pad.axes[m.index] ?? 0;
        return m.inverted ? -raw : raw;
      };

      const thr = getVal(calibration.axes.throttle);
      const yaw = getVal(calibration.axes.yaw);
      const pit = getVal(calibration.axes.pitch);
      const rol = getVal(calibration.axes.roll);

      // Compute display percentages
      const thrPct = Math.round(((thr + 1) / 2) * 100);
      const yawPct = Math.round(yaw * 100);
      const pitPct = Math.round(pit * 100);
      const rolPct = Math.round(rol * 100);

      valThrottle.textContent = `${thrPct}%`;
      valYaw.textContent =
        yawPct > 0 ? `L ${yawPct}%` : yawPct < 0 ? `R ${-yawPct}%` : "0%";
      valPitch.textContent = `${pitPct > 0 ? "+" : ""}${pitPct}%`;
      valRoll.textContent = `${rolPct > 0 ? "+" : ""}${rolPct}%`;

      numThrottle.textContent = `${thrPct}%`;
      numYaw.textContent = valYaw.textContent;
      numPitch.textContent = `${pitPct}%`;
      numRoll.textContent = `${rolPct}%`;

      // Throttle meter: 0 to 100%
      meterThrottle.style.width = `${Math.max(0, Math.min(100, thrPct))}%`;
      // Center meters for Pitch & Roll: -100 to +100%
      const setCenterMeter = (fill: HTMLElement, pct: number) => {
        if (pct >= 0) {
          fill.style.left = "50%";
          fill.style.width = `${Math.min(50, pct / 2)}%`;
        } else {
          fill.style.left = `${Math.max(0, 50 + pct / 2)}%`;
          fill.style.width = `${Math.min(50, -pct / 2)}%`;
        }
      };

      // Yaw meter: Left turn (yaw > 0) fills to left, Right turn (yaw < 0) fills to right
      if (yaw >= 0) {
        const width = Math.min(50, (yaw / 2) * 100);
        meterYaw.style.left = `${50 - width}%`;
        meterYaw.style.width = `${width}%`;
      } else {
        const width = Math.min(50, (-yaw / 2) * 100);
        meterYaw.style.left = "50%";
        meterYaw.style.width = `${width}%`;
      }

      setCenterMeter(meterPitch, pitPct);
      setCenterMeter(meterRoll, rolPct);

      // Update Dual Gimbals Dots
      // Left Gimbal: X = Yaw (left turn = dot at left 0%, right turn = dot at right 100%)
      const leftX = ((1 - yaw) / 2) * 100;
      const leftY = ((1 - thr) / 2) * 100;
      leftStickDot.style.left = `${Math.max(0, Math.min(100, leftX))}%`;
      leftStickDot.style.top = `${Math.max(0, Math.min(100, leftY))}%`;

      // Right Gimbal: X = Roll (-1 to +1 -> 0% to 100%), Y = Pitch (-1 to +1 -> 100% to 0%)
      const rightX = ((rol + 1) / 2) * 100;
      const rightY = ((1 - pit) / 2) * 100;
      rightStickDot.style.left = `${Math.max(0, Math.min(100, rightX))}%`;
      rightStickDot.style.top = `${Math.max(0, Math.min(100, rightY))}%`;

      // Single-Axis Detect Mode (picks axis with maximum deflection)
      if (detectingAxis) {
        if (!axisBaseline) axisBaseline = [...pad.axes];
        let bestIndex = -1;
        let maxDelta = 0;
        let bestDeltaSign = 1;
        for (let i = 0; i < pad.axes.length; i++) {
          const delta = pad.axes[i] - (axisBaseline[i] ?? 0);
          const abs = Math.abs(delta);
          if (abs > maxDelta) {
            maxDelta = abs;
            bestIndex = i;
            bestDeltaSign = Math.sign(delta) || 1;
          }
        }
        if (bestIndex >= 0 && maxDelta > 0.38) {
          calibration.axes[detectingAxis].index = bestIndex;
          if (detectingAxis === "throttle" || detectingAxis === "pitch") {
            calibration.axes[detectingAxis].inverted = bestDeltaSign > 0;
          } else {
            calibration.axes[detectingAxis].inverted = bestDeltaSign < 0;
          }
          const cap =
            detectingAxis.charAt(0).toUpperCase() + detectingAxis.slice(1);
          const det = el<HTMLButtonElement>(`det${cap}`);
          det.classList.remove("detecting");
          det.textContent = "Detect";
          detectingAxis = null;
          axisBaseline = null;
          syncUIFromCalibration();
        }
      }

      // Single-Button / Switch Detect Mode (listens to both digital buttons and axis switches)
      if (detectingButton) {
        if (!buttonBaseline) {
          buttonBaseline = pad.buttons.map(
            (b) => Boolean(b?.pressed || (b?.value ?? 0) > 0.45),
          );
        }
        if (!axisBaseline) {
          axisBaseline = [...pad.axes];
        }

        let detectedBinding: GamepadButtonBinding | null = null;

        // 1. Check digital buttons
        for (let i = 0; i < pad.buttons.length; i++) {
          const isPressed = Boolean(
            pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.45,
          );
          if (isPressed && !buttonBaseline[i]) {
            detectedBinding = i;
            break;
          }
        }

        // 2. Check axis switches (e.g. A4, A5)
        if (detectedBinding === null && axisBaseline) {
          for (let a = 0; a < pad.axes.length; a++) {
            const delta = pad.axes[a] - (axisBaseline[a] ?? 0);
            if (Math.abs(delta) > 0.45) {
              detectedBinding = {
                axis: a,
                direction: delta > 0 ? "positive" : "negative",
              };
              break;
            }
          }
        }

        if (detectedBinding !== null) {
          calibration.buttons[detectingButton] = detectedBinding;
          const cap =
            detectingButton.charAt(0).toUpperCase() + detectingButton.slice(1);
          const det = el<HTMLButtonElement>(`det${cap}`);
          det.classList.remove("detecting");
          det.textContent = "Detect";
          detectingButton = null;
          buttonBaseline = null;
          axisBaseline = null;
          syncUIFromCalibration();
        }
      }

      // Guided Wizard Auto-Detection & Advance (picks axis with maximum deflection)
      if (wizardActive && wizardConfirmedTimer == null) {
        const step = WIZARD_STEPS[wizardStep];
        if (step.axisKey) {
          if (!axisBaseline) axisBaseline = [...pad.axes];
          let bestIndex = -1;
          let maxDelta = 0;
          let bestDeltaSign = 1;
          for (let i = 0; i < pad.axes.length; i++) {
            const delta = pad.axes[i] - (axisBaseline[i] ?? 0);
            const abs = Math.abs(delta);
            if (abs > maxDelta) {
              maxDelta = abs;
              bestIndex = i;
              bestDeltaSign = Math.sign(delta) || 1;
            }
          }
          if (bestIndex >= 0 && maxDelta > 0.4) {
            calibration.axes[step.axisKey].index = bestIndex;
            if (step.axisKey === "throttle" || step.axisKey === "pitch") {
              calibration.axes[step.axisKey].inverted = bestDeltaSign > 0;
            } else {
              calibration.axes[step.axisKey].inverted = bestDeltaSign < 0;
            }
            syncUIFromCalibration();
            wizardInstruction.textContent = "✓ Detected! Next…";
            wizardConfirmedTimer = window.setTimeout(() => {
              wizardConfirmedTimer = null;
              wizardStep++;
              setupWizardStep();
            }, 450);
          }
        } else if (step.buttonKey) {
          if (!buttonBaseline) {
            buttonBaseline = pad.buttons.map(
              (b) => Boolean(b?.pressed || (b?.value ?? 0) > 0.45),
            );
          }
          if (!axisBaseline) {
            axisBaseline = [...pad.axes];
          }

          let detectedBinding: GamepadButtonBinding | null = null;
          let label = "";

          // Check digital buttons
          for (let i = 0; i < pad.buttons.length; i++) {
            const isPressed = Boolean(
              pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.45,
            );
            if (isPressed && !buttonBaseline[i]) {
              detectedBinding = i;
              label = `Button ${i}`;
              break;
            }
          }

          // Check axis switches
          if (detectedBinding === null && axisBaseline) {
            for (let a = 0; a < pad.axes.length; a++) {
              const delta = pad.axes[a] - (axisBaseline[a] ?? 0);
              if (Math.abs(delta) > 0.45) {
                detectedBinding = {
                  axis: a,
                  direction: delta > 0 ? "positive" : "negative",
                };
                label = `Axis ${a} (${delta > 0 ? "+" : "-"})`;
                break;
              }
            }
          }

          if (detectedBinding !== null) {
            calibration.buttons[step.buttonKey] = detectedBinding;
            syncUIFromCalibration();
            wizardInstruction.textContent = `✓ Detected ${label}! Next…`;
            buttonBaseline = null;
            axisBaseline = null;
            wizardConfirmedTimer = window.setTimeout(() => {
              wizardConfirmedTimer = null;
              wizardStep++;
              setupWizardStep();
            }, 450);
          }
        }
      }

      rafId = requestAnimationFrame(sample);
    };

    sample();
  });
}
