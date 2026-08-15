/**
 * The Node-specific entry point.
 *
 * Kept separate from the package's main entry so the engine can be bundled for
 * a browser. The renderer imports the pure planning functions from
 * "@stl-manager/core"; only a Node process may import this.
 */
export { NodeFileSystem } from "./nodeFileSystem.js";
