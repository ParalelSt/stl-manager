/** Ensures one library is only ever being written by one run at a time. */
export interface ApplyLock {
  /**
   * Runs work while holding the library's lock.
   *
   * @throws immediately when another run already holds it, naming that run
   */
  withLock<Result>(
    libraryRoot: string,
    jobId: string,
    work: () => Promise<Result>,
  ): Promise<Result>;
  /** The job currently holding a library, if any. */
  heldBy(libraryRoot: string): string | undefined;
}

/**
 * Builds a lock allowing one apply or undo per library.
 *
 * Two runs writing to one journal would interleave their entries, and undo
 * replays that journal backwards. Interleaved entries make the replay
 * incoherent, which would quietly destroy the guarantee the whole application
 * rests on. A second request is therefore refused outright rather than queued:
 * queueing would leave the user waiting on work they did not know was running.
 *
 * @returns The lock
 */
export function createApplyLock(): ApplyLock {
  const held = new Map<string, string>();

  return {
    async withLock<Result>(
      libraryRoot: string,
      jobId: string,
      work: () => Promise<Result>,
    ): Promise<Result> {
      const holder = held.get(libraryRoot);
      if (holder !== undefined) {
        throw new Error(`Another run is already working on this library (job ${holder}).`);
      }
      held.set(libraryRoot, jobId);
      try {
        return await work();
      } finally {
        // Released whatever happened. A lock left behind by a failure would
        // make the library permanently unusable until a restart.
        held.delete(libraryRoot);
      }
    },

    heldBy(libraryRoot: string): string | undefined {
      return held.get(libraryRoot);
    },
  };
}
