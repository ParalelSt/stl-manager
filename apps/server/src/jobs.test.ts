import { JOB_KIND, PROGRESS_KIND, type ProgressEvent } from "@stl-manager/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createJobRegistry, type JobRegistry } from "./jobs.js";

const NOW = 1_700_000_000_000;

function progress(done: number): ProgressEvent {
  return { kind: PROGRESS_KIND.SCAN, done, total: undefined, currentPath: "/data/x.stl" };
}

/** Lets the microtask queue drain so a started job can settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function never(): Promise<never> {
  return new Promise(() => {});
}

describe("JobRegistry", () => {
  let registry: JobRegistry;
  let clock: number;

  beforeEach(() => {
    clock = NOW;
    registry = createJobRegistry({ now: () => clock });
  });

  it("returns an identifier before the work finishes", () => {
    const id = registry.start(JOB_KIND.SCAN, () => never());
    expect(registry.get(id)?.state).toBe("running");
  });

  it("gives every job a distinct identifier", () => {
    const first = registry.start(JOB_KIND.SCAN, () => never());
    const second = registry.start(JOB_KIND.SCAN, () => never());
    expect(first).not.toBe(second);
  });

  it("records the result when the work succeeds", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => ({ files: 3 }));
    await settle();
    expect(registry.get(id)).toMatchObject({ state: "succeeded", result: { files: 3 } });
  });

  it("records the reason when the work throws", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => {
      throw new Error("disk on fire");
    });
    await settle();
    expect(registry.get(id)).toMatchObject({ state: "failed", error: "disk on fire" });
  });

  it("stamps when a job started and finished", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => "done");
    await settle();
    const job = registry.get(id);
    expect(job?.startedAt).toBe(NOW);
    expect(job?.finishedAt).toBe(NOW);
  });

  it("delivers progress to every listener", async () => {
    const seen: number[][] = [[], []];
    const id = registry.start(JOB_KIND.SCAN, async (report) => {
      await settle();
      report(progress(1));
      return "done";
    });
    registry.subscribe(id, (event) => seen[0]?.push(event.done));
    registry.subscribe(id, (event) => seen[1]?.push(event.done));
    await settle();
    await settle();
    expect(seen).toEqual([[1], [1]]);
  });

  it("stops delivering after unsubscribe", async () => {
    const seen: number[] = [];
    const id = registry.start(JOB_KIND.SCAN, async (report) => {
      await settle();
      report(progress(1));
      return "done";
    });
    const unsubscribe = registry.subscribe(id, (event) => seen.push(event.done));
    unsubscribe();
    await settle();
    await settle();
    expect(seen).toEqual([]);
  });

  it("keeps running when its only listener leaves", async () => {
    const id = registry.start(JOB_KIND.APPLY, async (report) => {
      report(progress(1));
      return "done";
    });
    registry.subscribe(id, () => {})();
    await settle();
    expect(registry.get(id)?.state).toBe("succeeded");
  });

  it("keeps the result for a subscriber that arrives late", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => "done");
    await settle();
    registry.subscribe(id, () => {});
    expect(registry.get(id)).toMatchObject({ state: "succeeded", result: "done" });
  });

  it("survives a listener that throws, and still finishes", async () => {
    const seen: number[] = [];
    const id = registry.start(JOB_KIND.SCAN, async (report) => {
      await settle();
      report(progress(1));
      return "done";
    });
    registry.subscribe(id, () => {
      throw new Error("the connection went away");
    });
    registry.subscribe(id, (event) => seen.push(event.done));
    await settle();
    await settle();
    expect(seen).toEqual([1]);
    expect(registry.get(id)?.state).toBe("succeeded");
  });

  it("drops progress reported before anyone was watching", async () => {
    // Progress is a live stream, not a log. Anything reported before a client
    // connects is gone, which is fine precisely because the result is fetched
    // separately rather than being carried by the stream.
    const seen: number[] = [];
    const id = registry.start(JOB_KIND.SCAN, async (report) => {
      report(progress(1));
      await settle();
      report(progress(2));
      return "done";
    });
    registry.subscribe(id, (event) => seen.push(event.done));
    await settle();
    await settle();
    expect(seen).toEqual([2]);
  });

  it("returns undefined for an unknown identifier", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  it("ignores a subscription to an unknown job", () => {
    expect(() => registry.subscribe("nope", () => {})()).not.toThrow();
  });

  it("forgets a finished job after the retention period", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => "done");
    await settle();
    clock = NOW + 31 * 60 * 1000;
    registry.sweep();
    expect(registry.get(id)).toBeUndefined();
  });

  it("keeps a finished job until the retention period is up", async () => {
    const id = registry.start(JOB_KIND.SCAN, async () => "done");
    await settle();
    clock = NOW + 29 * 60 * 1000;
    registry.sweep();
    expect(registry.get(id)?.state).toBe("succeeded");
  });

  it("never forgets a job that is still running", () => {
    const id = registry.start(JOB_KIND.SCAN, () => never());
    clock = NOW + 24 * 60 * 60 * 1000;
    registry.sweep();
    expect(registry.get(id)?.state).toBe("running");
  });

  it("reports progress after the job has finished to nobody", async () => {
    // A late report from work that has already settled must not resurrect it.
    let report: ((event: ProgressEvent) => void) | undefined;
    const id = registry.start(JOB_KIND.SCAN, async (reporter) => {
      report = reporter;
      return "done";
    });
    await settle();
    expect(() => report?.(progress(9))).not.toThrow();
    expect(registry.get(id)?.state).toBe("succeeded");
  });
});
