import { join } from "node:path";
// Electron ships as CommonJS, which does not expose named exports to ESM.
import electron from "electron";

const { app, BrowserWindow, shell } = electron;
import { registerHandlers } from "./handlers.js";
import { registerPeerHandlers } from "./peerHandlers.js";
import { registerShareHandlers } from "./shareHandlers.js";

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 820;
const MINIMUM_WIDTH = 900;
const MINIMUM_HEIGHT = 640;

function createWindow(): void {
  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MINIMUM_WIDTH,
    minHeight: MINIMUM_HEIGHT,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#faf9f6",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on("ready-to-show", () => {
    window.show();
  });

  // Links to the outside world open in the user's browser, never in the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
    return;
  }
  void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  registerHandlers();
  registerPeerHandlers();
  registerShareHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
