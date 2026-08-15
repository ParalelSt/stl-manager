import type { ProgressEvent } from "./schemas.js";

/** What a job is doing. */
export const JOB_KIND = {
  SCAN: "scan",
  APPLY: "apply",
  UNDO: "undo",
} as const;

/** One of the kinds of work a job performs. */
export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

/** Where a job has got to. */
export const JOB_STATE = {
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

/** One of the states a job can be in. */
export type JobState = (typeof JOB_STATE)[keyof typeof JOB_STATE];

/**
 * A job as seen by a client.
 *
 * Work that takes minutes cannot be held inside a single request: a laptop
 * sleeps, a connection drops, a proxy times out. A job is started, watched, and
 * collected separately, so losing the connection carrying progress does not
 * touch the work itself.
 *
 * The result is present only once the state is "succeeded", and the error only
 * once it is "failed".
 */
export interface JobEnvelope<Result> {
  id: string;
  kind: JobKind;
  state: JobState;
  startedAt: number;
  finishedAt: number | undefined;
  result: Result | undefined;
  error: string | undefined;
  /**
   * The most recent progress report.
   *
   * Carried here as well as on the event stream so that a client which simply
   * polls still shows progress, without needing to authenticate a second
   * connection.
   */
  progress: ProgressEvent | undefined;
}

/** The response to starting a job. */
export interface JobStarted {
  jobId: string;
}
