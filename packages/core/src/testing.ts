/**
 * Test helpers for anything that builds on the engine.
 *
 * A separate entry point so this never reaches a production bundle, in the
 * same way the Node adapter is separated from the pure engine.
 */
export {
  MemoryFileSystem,
  toPlainFileSystem,
  type MemoryFileSystemOptions,
  type MemorySeedEntry,
} from "./memoryFileSystem.js";
