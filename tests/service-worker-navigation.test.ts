import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

it.each(["https://example.com/", "https://example.com/repo/"])("uses each page's own offline shell under %s", async (scope) => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const match = vi.fn(async () => undefined);
  const worker = {
    registration: { scope },
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
  };
  new Function("self", "caches", "fetch", readFileSync("public/sw.js", "utf8"))(
    worker, { match }, async () => { throw new Error("offline"); },
  );
  for (const page of ["index.html", "play.html"]) {
    const url = `${scope}${page}?world=forest&mode=acro`;
    let result: Promise<unknown> | undefined;
    handlers.fetch({ request: { url, method: "GET", mode: "navigate", headers: new Headers() }, respondWith: (value: Promise<unknown>) => { result = value; } });
    await result;
    expect(match).toHaveBeenLastCalledWith(`${scope}${page}`);
  }
});
