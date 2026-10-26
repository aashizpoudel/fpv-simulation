import { describe, expect, it } from "vitest";
import { parsePlayChoices, playUrl } from "../src/app/page-navigation";

describe("game navigation", () => {
  it("defaults direct game visits to keyboard, angle and no VR", () => {
    expect(parsePlayChoices("")).toEqual({ control: "keyboard", mode: "angle", vr: false });
  });
  it("validates invalid parameters and motion outside VR", () => {
    expect(parsePlayChoices("?input=bad&mode=bad&vr=true")).toEqual(parsePlayChoices(""));
    expect(parsePlayChoices("?input=motion").control).toBe("keyboard");
    expect(parsePlayChoices("?input=motion&mode=acro&vr=1")).toEqual({ control: "motion", mode: "acro", vr: true });
    expect(parsePlayChoices("?input=gamepad&mode=acro").control).toBe("gamepad");
  });
  it.each(["https://example.com/", "https://example.com/repo/", "https://example.com/repo/index.html"])("uses sibling game URL from %s", (source) => {
    const url = new URL(playUrl(source, "forest", parsePlayChoices("")));
    expect(url.pathname).toBe(source.includes("repo") ? "/repo/play.html" : "/play.html");
  });
  it("forces the compatible renderer only for VR", () => {
    const url = new URL(playUrl("https://example.com/repo/", "forest", parsePlayChoices("?vr=1")));
    expect(url.searchParams.get("renderer")).toBe("threejs");
  });
});
