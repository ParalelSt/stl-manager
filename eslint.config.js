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
    ignores: ["**/dist/**", "**/dist-web/**", "**/out/**", "**/release/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // Destructuring a field out in order to drop it is the clearest way to
      // omit something, and the rest sibling is the point rather than an
      // oversight. A leading underscore marks anything else deliberate.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
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
    // The interface package is bundled for both Electron and a browser, so it
    // must never reach for Node or Electron. Finding out at Docker build time
    // is far too late.
    files: ["packages/ui/**/*.ts", "packages/ui/**/*.tsx"],
    ignores: ["packages/ui/**/*.test.ts", "packages/ui/**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "electron", "@stl-manager/core/node"],
              message:
                "The interface package must run in a browser as well as in Electron, so it cannot import Node, Electron, or the engine's Node entry point.",
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
  {
    // Build hooks that a tool loads with require(), such as electron-builder's
    // afterSign, have to be CommonJS.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...NODE_GLOBALS, require: "readonly", exports: "writable", module: "writable" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
