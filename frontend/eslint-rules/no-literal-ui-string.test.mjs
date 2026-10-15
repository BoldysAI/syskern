import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import rule from "./no-literal-ui-string.mjs";

function lint(code, filename = "src/fixture.tsx") {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    [
      {
        files: ["**/*.{ts,tsx,js,jsx}"],
        plugins: { local: { rules: { "no-literal-ui-string": rule } } },
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "local/no-literal-ui-string": "error" },
      },
    ],
    { filename },
  );
}

test("allows catalog keys and non-display strings", () => {
  const samples = [
    "export const x = t('nav.catalog');",
    "export const x = translate('nav.catalog');",
    "export function C() { return <button className=\"btn\">{t('common.save')}</button>; }",
    "export function C() { return <span>—</span>; }",
    "export const path = '/catalog';",
    "export const role = 'admin';",
    "const incoterm = value || 'EXW';",
    "const role = value || 'viewer';",
    "const badge = kind ?? 'bg-muted text-muted-foreground';",
    "const empty = value || '—';",
    "const pending = value ?? '…';",
  ];
  for (const code of samples) {
    const messages = lint(code).filter((m) => m.ruleId);
    assert.equal(messages.length, 0, code);
  }
});

test("rejects displayable literals", () => {
  const samples = [
    "export function C() { return <button>Enregistrer</button>; }",
    "export function C() { return <input placeholder=\"Rechercher\" />; }",
    "export const crumb = { label: 'Tableau de bord' };",
    "const name = params.get('n') || 'Fournisseur';",
  ];
  for (const code of samples) {
    const messages = lint(code).filter((m) => m.ruleId);
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].messageId, "literal");
  }
});
