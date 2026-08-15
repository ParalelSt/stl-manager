import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

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
    files: ["packages/core/src/nodeFileSystem.ts", "packages/core/src/*.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
