/** What role a file plays in the library. */
export const FILE_KIND = {
  MESH: "mesh",
  SLICER: "slicer",
  COMPANION: "companion",
} as const;

/** One of the roles a collected file can have. */
export type FileKind = (typeof FILE_KIND)[keyof typeof FILE_KIND];

/** The pipeline stage a problem was recorded in. */
export const PIPELINE_STAGE = {
  SCAN: "scan",
  GROUP: "group",
  PLAN: "plan",
  APPLY: "apply",
  UNDO: "undo",
} as const;

/** One of the four pipeline stages, or the undo operation. */
export type PipelineStage = (typeof PIPELINE_STAGE)[keyof typeof PIPELINE_STAGE];

/**
 * A single file recorded during a scan.
 *
 * Nothing described by this record has been moved. A scan only observes.
 */
export interface ScannedFile {
  /** Absolute path to the file as it exists right now. */
  path: string;
  /** Filename without its extension, exactly as it appears on disk. */
  stem: string;
  /** Lowercased extension including the leading dot, for example ".stl". */
  ext: string;
  size: number;
  mtimeMs: number;
  /** Creation time, or 0 on filesystems that do not record one. */
  birthtimeMs: number;
  /** Identifies the volume, so the applier can detect cross-volume moves. */
  deviceId: number;
  /** Absolute path of the directory holding the file. */
  sourceDir: string;
  /** Index parsed from a duplicate marker such as "(3)", if present. */
  duplicateIndex: number | undefined;
  kind: FileKind;
}

/**
 * A non-fatal failure recorded by a pipeline stage.
 *
 * Problems are collected and reported together rather than thrown, because an
 * unreadable directory or a vanished file is an expected condition when
 * walking a whole machine, not an exceptional one.
 */
export interface Problem {
  path: string;
  stage: PipelineStage;
  message: string;
}

/** Why a file is being moved. */
export const MOVE_REASON = {
  MODEL: "model",
  COMPANION: "companion",
  DUPLICATE: "duplicate",
} as const;

/** One of the reasons a move can be planned. */
export type MoveReason = (typeof MOVE_REASON)[keyof typeof MOVE_REASON];
