import { describe, expect, it, vi } from "vitest";
import { applyBetaflightTuning } from "../src/physics/betaflight-tuning";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { DroneSimModule } from "../src/vendor/dronesim";

describe("Betaflight startup tuning", () => {
  it("sends configured rates and native PID gains to the Rust endpoints", () => {
    const config = structuredClone(Tinyhawk3Config);
    config.rates = { rcRate: 1.23, expo: 0.17, superRate: 0.65 };
    config.betaflightPids.roll = { p: 52, i: 73, d: 24 };
    config.betaflightPids.pitch = { p: 54, i: 75, d: 26 };
    config.betaflightPids.yaw = { p: 48, i: 82, d: 0 };

    const heap = new Uint8Array(32);
    const sent: number[][] = [];
    const free = vi.fn();
    const wasm = {
      HEAPU8: heap,
      _malloc: vi.fn(() => 8),
      _free: free,
      _dronesim_set_rates: vi.fn((handle: number, ptr: number, len: number) => {
        expect(handle).toBe(42);
        sent.push(Array.from(heap.subarray(ptr, ptr + len)));
        return 1;
      }),
      _dronesim_set_pid_rate_config: vi.fn((handle: number, ptr: number, len: number) => {
        expect(handle).toBe(42);
        sent.push(Array.from(heap.subarray(ptr, ptr + len)));
        return 1;
      }),
    } as unknown as DroneSimModule;

    applyBetaflightTuning(wasm, 42, config);
    expect(sent).toEqual([
      [0, 123, 123, 123, 17, 17, 17, 65, 65, 65],
      [52, 73, 24, 54, 75, 26, 48, 82, 0],
    ]);
    expect(free).toHaveBeenCalledWith(8);
  });

  it("surfaces a rejected tuning update and frees its WASM buffer", () => {
    const free = vi.fn();
    const wasm = {
      HEAPU8: new Uint8Array(32),
      _malloc: () => 8,
      _free: free,
      _dronesim_set_rates: () => 1,
      _dronesim_set_pid_rate_config: () => 0,
    } as unknown as DroneSimModule;
    expect(() => applyBetaflightTuning(wasm, 42, Tinyhawk3Config))
      .toThrow("Betaflight rejected drone PID gains");
    expect(free).toHaveBeenCalledWith(8);
  });
});
