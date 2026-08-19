import { beforeEach, describe, expect, it } from "vitest";
import { createAuthLimiter, type AuthLimiter } from "./rateLimit.js";

const START = 1_700_000_000_000;

describe("AuthLimiter", () => {
  let clock: number;
  let limiter: AuthLimiter;

  beforeEach(() => {
    clock = START;
    limiter = createAuthLimiter({ maxFailures: 3, windowMs: 1000, now: () => clock });
  });

  it("allows an address that has not failed", () => {
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("allows failures below the limit", () => {
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("blocks an address that reaches the limit", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.recordFailure("1.2.3.4");
    }
    expect(limiter.isBlocked("1.2.3.4")).toBe(true);
  });

  it("blocks only the offending address", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.recordFailure("1.2.3.4");
    }
    expect(limiter.isBlocked("5.6.7.8")).toBe(false);
  });

  it("forgets failures once the window has passed", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.recordFailure("1.2.3.4");
    }
    clock = START + 1001;
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("clears the count when the address finally succeeds", () => {
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordSuccess("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    // A person who mistypes and then gets it right is not punished afterwards.
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("says how long the wait is", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.recordFailure("1.2.3.4");
    }
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(1);
  });

  it("reports no wait for an address that is not blocked", () => {
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(0);
  });

  it("does not grow without bound for an address that stops", () => {
    limiter.recordFailure("1.2.3.4");
    clock = START + 5000;
    // Reading it prunes the expired entries rather than keeping them forever.
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBe(0);
  });
});
