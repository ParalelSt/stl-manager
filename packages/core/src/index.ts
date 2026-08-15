export { apply, type ApplyOptions, type ApplyResult } from "./applier.js";
export {
  attachCompanions,
  type CompanionAssignment,
} from "./companions.js";
export {
  resolveDuplicates,
  selectWinner,
  type DuplicateResolution,
} from "./duplicates.js";
export {
  COLLECTED_EXTENSIONS,
  isExcluded,
  EXCLUDED_DIRECTORY_NAMES,
  EXCLUDED_DIRECTORY_SUFFIXES,
  EXCLUDED_PATH_ROOTS,
} from "./exclusions.js";
export type { DirEntry, FileStat, FileSystem, PathUtil } from "./fileSystem.js";
export { group, type FileGroup } from "./grouper.js";
export {
  Journal,
  JOURNAL_FILENAME,
  OPERATION_OUTCOME,
  STATE_FOLDER,
  type JournalEntry,
  type OperationOutcome,
  type RunSummary,
} from "./journal.js";
export { parseDuplicateIndex, toNameKey } from "./nameKey.js";
export {
  isValidGroupName,
  mergeGroups,
  renameGroup,
  setExcluded,
  setPurpose,
  splitGroup,
} from "./planEditor.js";
export {
  deriveMoves,
  folderFor,
  MOVE_REASON,
  plan,
  QUARANTINE_FOLDER,
  type GroupPlan,
  type MoveReason,
  type PlannedMove,
  type PlanModel,
  type PlanOptions,
  type SortPlan,
} from "./planner.js";
export { posixPath } from "./posixPath.js";
export { scan, type ScanOptions, type ScanResult } from "./scanner.js";
export {
  FILE_KIND,
  PIPELINE_STAGE,
  type FileKind,
  type PipelineStage,
  type Problem,
  type ScannedFile,
} from "./types.js";
export { undo, type UndoOptions, type UndoResult } from "./undo.js";
