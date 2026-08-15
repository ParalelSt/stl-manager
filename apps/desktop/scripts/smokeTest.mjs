/**
 * Loads the built renderer in a hidden window and checks the app is wired up.
 *
 * Unit tests cover the engine and the IPC schemas, but nothing else proves the
 * three processes actually fit together: that the preload bridge reaches the
 * renderer, that context isolation is really on, and that the stylesheet was
 * applied. Run it after building, with:
 *
 *   npm run smoke -w apps/desktop
 *
 * Note that Electron refuses to start a GUI when ELECTRON_RUN_AS_NODE is set,
 * which some editors and terminals export. The npm script unsets it.
 */
import { join } from "node:path";
import electron from "electron";

const { app, BrowserWindow } = electron;
const here = import.meta.dirname;

/**
 * The exact capabilities the renderer is given.
 *
 * Deliberately an exact list rather than a subset check, so that adding a way
 * for the interface to reach the system is a decision someone has to make on
 * purpose rather than something that arrives unnoticed.
 */
const EXPECTED_BRIDGE_METHODS = [
  "applyPlan",
  "buildPlan",
  "chooseDirectory",
  "listRuns",
  "onProgress",
  "readLibrary",
  "revealInFinder",
  "undoRun",
];

const EXPECTED_BACKGROUND = "rgb(250, 249, 246)";

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(here, "../out/preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await window.loadFile(join(here, "../out/renderer/index.html"));

  const report = await window.webContents.executeJavaScript(`(() => ({
    hasBridge: typeof window.stlManager === "object" && window.stlManager !== null,
    bridgeMethods: window.stlManager ? Object.keys(window.stlManager).sort() : [],
    hasNodeAccess: typeof window.require !== "undefined" || typeof window.process !== "undefined",
    heading: document.querySelector("h1")?.textContent ?? null,
    buttons: [...document.querySelectorAll("button")].map((b) => b.textContent),
    background: getComputedStyle(document.body).backgroundColor,
    headingFont: getComputedStyle(document.querySelector("h1")).fontFamily,
  }))()`);

  const failures = [];
  if (!report.hasBridge) {
    failures.push("window.stlManager is missing");
  }
  if (report.hasNodeAccess) {
    failures.push("Node APIs leaked into the renderer");
  }
  if (report.heading !== "Choose where things go") {
    failures.push(`the setup screen did not render; heading was ${JSON.stringify(report.heading)}`);
  }
  if (!report.buttons.includes("Scan for models")) {
    failures.push(`the primary action is missing; buttons were ${JSON.stringify(report.buttons)}`);
  }
  if (report.background !== EXPECTED_BACKGROUND) {
    failures.push(`the background was ${report.background}, so the stylesheet did not load`);
  }
  if (!report.headingFont.toLowerCase().includes("georgia")) {
    failures.push(`headings are not serif: ${report.headingFont}`);
  }
  if (JSON.stringify(report.bridgeMethods) !== JSON.stringify(EXPECTED_BRIDGE_METHODS)) {
    failures.push(`the bridge exposed ${JSON.stringify(report.bridgeMethods)}`);
  }

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    console.error(`FAILED:\n${failures.map((failure) => ` - ${failure}`).join("\n")}`);
    app.exit(1);
    return;
  }

  console.log("Smoke test passed.");
  app.exit(0);
});
