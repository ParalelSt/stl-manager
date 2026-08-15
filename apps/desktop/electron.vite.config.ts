import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const WORKSPACE_PACKAGES = ["@stl-manager/core", "@stl-manager/contracts", "@stl-manager/ui"];

export default defineConfig({
  main: {
    // The workspace packages are bundled in, because the packaged application
    // ships no node_modules for them to be resolved from.
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
