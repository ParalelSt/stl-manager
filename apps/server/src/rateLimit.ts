/** Tracks failed authentication so a token cannot be guessed at speed. */
export interface AuthLimiter {
  /** Records a refusal from an address. */
  recordFailure(address: string): void;
  /** Clears an address's history after it authenticates successfully. */
  recordSuccess(address: string): void;
  /** Whether an address has failed too often to be answered again yet. */
  isBlocked(address: string): boolean;
  /** How long an address must wait, in whole seconds. */
  retryAfterSeconds(address: string): number;
}

/** Failures allowed from one address before it is made to wait. */
const DEFAULT_MAX_FAILURES = 10;

/** How long failures are remembered, and how long a block lasts. */
const DEFAULT_WINDOW_MS = 60_000;

/** Options, present so tests can control time. */
export interface AuthLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Builds a limiter for failed authentication.
 *
 * A sixty-four character token is not guessable, but an endpoint that answers a
 * million attempts a second is still a mistake, and phase 4 makes this server
 * reachable from the internet. Failures are counted per address within a
 * window; too many and the address waits.
 *
 * Successful authentication clears the count, so a person mistyping a token a
 * few times and then getting it right is not punished afterwards.
 *
 * @param options - Limits and clock, for tests
 * @returns The limiter
 */
export function createAuthLimiter(options: AuthLimiterOptions = {}): AuthLimiter {
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now;

  const failures = new Map<string, number[]>();

  function recent(address: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (failures.get(address) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) {
      failures.delete(address);
    } else {
      failures.set(address, kept);
    }
    return kept;
  }

  return {
    recordFailure(address: string): void {
      failures.set(address, [...recent(address), now()]);
    },

    recordSuccess(address: string): void {
      failures.delete(address);
    },

    isBlocked(address: string): boolean {
      return recent(address).length >= maxFailures;
    },

    retryAfterSeconds(address: string): number {
      const attempts = recent(address);
      const oldest = attempts[0];
      if (oldest === undefined) {
        return 0;
      }
      return Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000));
    },
  };
}
