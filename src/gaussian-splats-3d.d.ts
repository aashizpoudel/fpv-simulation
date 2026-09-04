declare module "@mkkellogg/gaussian-splats-3d" {
  import { Group } from "three";

  export class DropInViewer extends Group {
    constructor(options?: Record<string, unknown>);
    addSplatScene(path: string, options?: Record<string, unknown>): PromiseLike<unknown>;
    removeSplatScene(index: number, showLoadingUI?: boolean): PromiseLike<unknown>;
    getSceneCount(): number;
    dispose(): Promise<void>;
  }

  export const SceneRevealMode: { Instant: number };
}
