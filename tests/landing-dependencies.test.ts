import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps the landing import graph free of simulator runtime dependencies", () => {
  const visited = new Set<string>();
  function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    expect(text).not.toMatch(/import\s*\(/);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
      const target = (node.moduleSpecifier as ts.StringLiteral).text;
      if (target.endsWith(".css")) continue;
      expect(target.startsWith(".")).toBe(true);
      const dependency = resolve(dirname(path), `${target}.ts`);
      expect(dependency).not.toMatch(/app-orchestrator|\/config\/|\/renderers\/|\/physics\/|\/core\//);
      visit(dependency);
    }
  }
  visit(resolve("src/app/welcome-screen.ts"));
});
