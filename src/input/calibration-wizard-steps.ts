export type AxisKey = "throttle" | "yaw" | "pitch" | "roll";
export type ButtonKey = "arm" | "reset" | "mode" | "camera";

export type WizardStep = {
  axisKey?: AxisKey;
  buttonKey?: ButtonKey;
  instruction: string;
  targetGimbal?: "left" | "right";
  targetPos?: { x: number; y: number }; // 0 to 1
};

export const WIZARD_STEPS: WizardStep[] = [
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
