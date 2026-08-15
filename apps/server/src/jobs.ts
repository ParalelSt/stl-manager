import { randomUUID } from "node:crypto";
import {
  JOB_STATE,
  type JobEnvelope,
  type JobKind,
  type ProgressEvent,
} from "@stl-manager/contracts";

/** How long a finished job's result is kept before being discarded. */
const DEFAULT_RETENTION_MS = 30 * 60 * 1000;

/** A listener receiving a job's progress. */
export type ProgressListener = (progress: ProgressEvent) => void;

/** Starts work, tracks it, and fans its progress out to whoever is watching. */
export interface JobRegistry {
  /**
   * Starts work and returns its identifier immediately.
   *
   * The work is never awaited here: the whole point is that the request which
   * started it can return before it finishes.
   */
  start<Result>(
    kind: JobKind,
    work: (report: ProgressListener) => Promise<Result>,
  ): string;
  /** The job's current state, or undefined when unknown or expired. */
  get(id: string): JobEnvelope<unknown> | undefined;
  /** Watches a job's progress. Returns a function that stops watching. */
  subscribe(id: string, listener: ProgressListener): () => void;
  /** Discards finished jobs that are older than the retention period. */
  sweep(): void;
}

interface JobRecord {
  envelope: JobEnvelope<unknown>;
  listeners: Set<ProgressListener>;
}

/** Options, present so tests can control time and retention. */
export interface JobRegistryOptions {
  retentionMs?: number;
  now?: () => number;
}

/**
 * Builds a registry of running and recently finished work.
 *
 * Nothing here is durable. A restart loses progress reporting, but not the
 * ability to undo: the durable record of what happened to files is the journal
 * the engine writes inside the library as the work happens.
 *
 * @param options - Retention period and clock, for tests
 * @returns The registry
 */
export function createJobRegistry(options: JobRegistryOptions = {}): JobRegistry {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const now = options.now ?? Date.now;
  const jobs = new Map<string, JobRecord>();

  function finish(id: string, change: (envelope: JobEnvelope<unknown>) => void): void {
    const record = jobs.get(id);
    if (record === undefined) {
      return;
    }
    change(record.envelope);
    record.envelope.finishedAt = now();
    // Listeners are dropped as soon as the work settles: a stream that is
    // still open will notice the job has left the running state and close.
    record.listeners.clear();
  }

  return {
    start<Result>(kind: JobKind, work: (report: ProgressListener) => Promise<Result>): string {
      const id = randomUUID();
      const record: JobRecord = {
        envelope: {
          id,
          kind,
          state: JOB_STATE.RUNNING,
          startedAt: now(),
          finishedAt: undefined,
          result: undefined,
          error: undefined,
          progress: undefined,
        },
        listeners: new Set(),
      };
      jobs.set(id, record);

      const report: ProgressListener = (progress) => {
        record.envelope.progress = progress;
        for (const listener of record.listeners) {
          try {
            listener(progress);
          } catch {
            // A listener is a network connection, and a client disconnecting
            // mid-write is ordinary. One failing listener must not stop the
            // work or the others.
          }
        }
      };

      work(report).then(
        (result) => {
          finish(id, (envelope) => {
            envelope.state = JOB_STATE.SUCCEEDED;
            envelope.result = result;
          });
        },
        (error: unknown) => {
          finish(id, (envelope) => {
            envelope.state = JOB_STATE.FAILED;
            envelope.error = error instanceof Error ? error.message : String(error);
          });
        },
      );

      return id;
    },

    get(id: string): JobEnvelope<unknown> | undefined {
      return jobs.get(id)?.envelope;
    },

    subscribe(id: string, listener: ProgressListener): () => void {
      const record = jobs.get(id);
      if (record === undefined) {
        return () => {};
      }
      record.listeners.add(listener);
      return () => {
        record.listeners.delete(listener);
      };
    },

    sweep(): void {
      const cutoff = now() - retentionMs;
      for (const [id, record] of jobs) {
        const finishedAt = record.envelope.finishedAt;
        if (finishedAt !== undefined && finishedAt <= cutoff) {
          jobs.delete(id);
        }
      }
    },
  };
}
