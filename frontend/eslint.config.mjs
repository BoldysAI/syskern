import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noLiteralUiString from "./eslint-rules/no-literal-ui-string.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/i18n/**"],
    plugins: {
      local: {
        rules: {
          "no-literal-ui-string": noLiteralUiString,
        },
      },
    },
    rules: {
      "local/no-literal-ui-string": "error",
    },
  },
  {
    // Honour the `_`-prefix convention for intentionally unused bindings
    // (e.g. destructuring-omit `{ a: _omit, ...rest }`, unused callback args).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
