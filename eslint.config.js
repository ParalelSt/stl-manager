import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_GLOBALS = {
  console: "readonly",
  process: "readonly",
  URL: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/out/**", "**/release/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // The engine must reach the disk only through the FileSystem port, so that
    // it stays testable in memory and a remote peer or cloud drive can
    // implement the same interface in a later phase. nodeFileSystem.ts is the
    // single permitted implementation, and tests may set up real fixtures.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/nodeFileSystem.ts", "packages/core/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:fs", "node:fs/*", "fs", "fs/*"],
              message:
                "The engine must reach the disk through the FileSystem port. Only nodeFileSystem.ts may import node:fs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: NODE_GLOBALS,
    },
  },
);
