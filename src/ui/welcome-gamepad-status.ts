/**
 * Welcome-screen gamepad status: "Gamepad detected" with a reset button, or
 * "Gamepad not detected" with a detect button. Browsers only expose a gamepad
 * after one of its buttons is pressed while the page is open.
 */
export function setupWelcomeGamepadStatus(): () => void {
  const root = document.getElementById("welcomeGamepad");
  const status = document.getElementById("welcomeGamepadStatus");
  const button = document.getElementById("welcomeGamepadBtn") as HTMLButtonElement | null;
  if (!root || !status || !button) return () => {};

  let detected: number | null = null;
  const control = document.getElementById("welcomeControlSelect") as HTMLSelectElement | null;
  const gamepadOption = control?.querySelector<HTMLOptionElement>('option[value="gamepad"]') ?? null;

  const findGamepad = (): Gamepad | null =>
    Array.from(navigator.getGamepads?.() ?? []).find((pad): pad is Gamepad => !!pad) ?? null;

  const render = (hint?: string) => {
    const available = detected !== null;
    root.dataset.state = available ? "detected" : "missing";
    status.textContent = available ? "Gamepad detected" : hint ?? "Gamepad not detected";
    button.textContent = available ? "Reset gamepad detection" : "Detect gamepad";
    if (gamepadOption) gamepadOption.disabled = !available;
    if (!available && control?.value === "gamepad") control.value = "keyboard";
  };

  const detect = (): boolean => {
    detected = findGamepad()?.index ?? null;
    return detected !== null;
  };

  const onClick = () => {
    if (detected !== null) {
      // Forget the current gamepad so a different one can be detected.
      detected = null;
      render();
    } else if (!detect()) {
      render("Gamepad not detected. Connect it, press any button, then select Detect gamepad.");
    } else {
      render();
    }
    button.blur();
  };
  const onConnect = (event: GamepadEvent) => {
    if (detected === null) {
      detected = event.gamepad.index;
      render();
    }
  };
  const onDisconnect = (event: GamepadEvent) => {
    if (event.gamepad.index !== detected) return;
    detected = null;
    detect();
    render();
  };

  button.addEventListener("click", onClick);
  window.addEventListener("gamepadconnected", onConnect);
  window.addEventListener("gamepaddisconnected", onDisconnect);
  detect();
  render();

  return () => {
    button.removeEventListener("click", onClick);
    window.removeEventListener("gamepadconnected", onConnect);
    window.removeEventListener("gamepaddisconnected", onDisconnect);
  };
}
