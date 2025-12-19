import type { Controls, DroneTelemetry } from '../types';

export interface IPhysics {
    init(): Promise<void>;
    step(controls: Controls, deltaTime: number): DroneTelemetry;
    reset(): void;
    setArmed(armed: boolean): void;
    togglePush(direction: number): void;
}
