import { beforeEach, describe, expect, it } from "vitest";
import { createApplyLock, type ApplyLock } from "./applyLock.js";

function never(): Promise<never> {
  return new Promise(() => {});
}

describe("ApplyLock", () => {
  let lock: ApplyLock;

  beforeEach(() => {
    lock = createApplyLock();
  });

  it("runs work when the library is free", async () => {
    await expect(lock.withLock("/lib", "job-1", async () => "done")).resolves.toBe("done");
  });

  it("refuses a second run against the same library", async () => {
    void lock.withLock("/lib", "job-1", () => never());
    await expect(lock.withLock("/lib", "job-2", async () => "x")).rejects.toThrow(/job-1/);
  });

  it("allows concurrent runs against different libraries", async () => {
    void lock.withLock("/lib-a", "job-1", () => never());
    await expect(lock.withLock("/lib-b", "job-2", async () => "ok")).resolves.toBe("ok");
  });

  it("releases the lock when the work succeeds", async () => {
    await lock.withLock("/lib", "job-1", async () => "done");
    await expect(lock.withLock("/lib", "job-2", async () => "again")).resolves.toBe("again");
  });

  it("releases the lock when the work throws", async () => {
    await expect(
      lock.withLock("/lib", "job-1", async () => {
        throw new Error("disk on fire");
      }),
    ).rejects.toThrow("disk on fire");
    await expect(lock.withLock("/lib", "job-2", async () => "ok")).resolves.toBe("ok");
  });

  it("reports which job holds a library", async () => {
    void lock.withLock("/lib", "job-1", () => never());
    expect(lock.heldBy("/lib")).toBe("job-1");
    expect(lock.heldBy("/other")).toBeUndefined();
  });

  it("reports nothing once the work has finished", async () => {
    await lock.withLock("/lib", "job-1", async () => "done");
    expect(lock.heldBy("/lib")).toBeUndefined();
  });

  it("does not let a refused caller release the holder's lock", async () => {
    void lock.withLock("/lib", "job-1", () => never());
    await expect(lock.withLock("/lib", "job-2", async () => "x")).rejects.toThrow();
    // The refusal must not have cleared job-1's hold on its way out.
    expect(lock.heldBy("/lib")).toBe("job-1");
  });
});
