export const WIZARD_HTML = `
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

      <div class="cal-body">
      <!-- Guided wizard banner (hidden by default) -->
      <div class="cal-wizard-banner" id="calWizardBanner" style="display: none;">
        <div class="cal-wizard-banner-text">
          <span class="cal-wizard-step-tag" id="calWizardStepTag">STEP 1/6</span>
          <span id="calWizardInstruction">Push Throttle fully DOWN, then UP</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="cal-secondary-btn" id="calWizardSkipBtn">Skip</button>
          <button type="button" class="cal-secondary-btn" id="calWizardExitBtn">Exit Wizard</button>
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

      <!-- Guided wizard trigger -->
      <div class="cal-wizard-actions">
        <button type="button" class="cal-wizard-launch-btn" id="launchWizardBtn">✨ Run Guided Wizard</button>
      </div>

      </div>

      <!-- Footer Actions -->
      <div class="cal-footer">
        <div style="display: flex; gap: 8px;">
          <button type="button" class="cal-cancel-btn" id="calCancelBtn">Cancel</button>
          <button type="button" class="cal-secondary-btn" id="calSwitchKeyboardBtn">⌨ Switch to Keyboard</button>
        </div>
        <button type="button" class="cal-save-btn" id="calSaveBtn">Save &amp; Fly</button>
      </div>
    `;
