import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HomeWorldConfig } from "../src/config/home-world-config";
import { resolveWorld, resolveWorldName } from "../src/app/url-options";

describe("home world", () => {
  it("selects Home from the URL and keeps the balcony spawn", () => {
    window.history.replaceState({}, "", "?world=home");
    expect(resolveWorldName()).toBe("home");
    expect(resolveWorld("home")).toBe(HomeWorldConfig);
    expect(HomeWorldConfig.spawnPosition).toEqual({ x: 0.2, y: 7.8, z: 0.05 });
    expect(HomeWorldConfig.spawnYaw).toBeCloseTo(-Math.PI / 2);
    expect(HomeWorldConfig.proceduralWorld).toBe("home");
    window.history.replaceState({}, "", "/");
  });

  it("lists Home on the landing page and in flight settings", async () => {
    expect(await readFile("index.html", "utf8")).toContain('value="home"');
    expect(await readFile("play.html", "utf8")).toContain('value="home"');
  });
});
