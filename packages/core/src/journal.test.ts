import { describe, expect, it } from "vitest";
import { Journal, type JournalEntry } from "./journal.js";
import { MemoryFileSystem } from "./memoryFileSystem.js";
import { posixPath } from "./posixPath.js";

const JOURNAL_PATH = "/lib/.stl-manager/journal.jsonl";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    runId: "run-1",
    at: 1000,
    from: "/a/x.stl",
    to: "/lib/x/x.stl",
    reason: "model",
    outcome: "moved",
    ...overrides,
  };
}

describe("Journal", () => {
  it("appends entries as one JSON object per line", async () => {
    const fs = new MemoryFileSystem({});
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());
    await journal.append(entry({ from: "/a/y.stl" }));

    const lines = await fs.readLines(JOURNAL_PATH);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ from: "/a/x.stl" });
  });

  it("reads back only the entries for one run", async () => {
    const journal = new Journal(new MemoryFileSystem({}), posixPath, "/lib");
    await journal.append(entry({ runId: "run-1" }));
    await journal.append(entry({ runId: "run-2", from: "/a/z.stl" }));

    const entries = await journal.read("run-2");
    expect(entries.map((item) => item.from)).toEqual(["/a/z.stl"]);
  });

  it("reads every run when none is named", async () => {
    const journal = new Journal(new MemoryFileSystem({}), posixPath, "/lib");
    await journal.append(entry({ runId: "run-1" }));
    await journal.append(entry({ runId: "run-2" }));
    expect(await journal.read()).toHaveLength(2);
  });

  it("survives a truncated final line without losing the rest", async () => {
    const fs = new MemoryFileSystem({
      [JOURNAL_PATH]: { content: `${JSON.stringify(entry())}\n{"broken"` },
    });
    const journal = new Journal(fs, posixPath, "/lib");
    expect(await journal.read()).toHaveLength(1);
  });

  it("ignores a line that parses but is not an entry", async () => {
    const fs = new MemoryFileSystem({
      [JOURNAL_PATH]: { content: `${JSON.stringify(entry())}\n{"unrelated":true}\n` },
    });
    const journal = new Journal(fs, posixPath, "/lib");
    expect(await journal.read()).toHaveLength(1);
  });

  it("returns nothing when no journal exists yet", async () => {
    const journal = new Journal(new MemoryFileSystem({}), posixPath, "/lib");
    expect(await journal.read()).toEqual([]);
    expect(await journal.listRuns()).toEqual([]);
  });

  it("summarises runs newest first", async () => {
    const journal = new Journal(new MemoryFileSystem({}), posixPath, "/lib");
    await journal.append(entry({ runId: "run-1", at: 1000 }));
    await journal.append(entry({ runId: "run-2", at: 2000 }));

    const runs = await journal.listRuns();
    expect(runs.map((run) => run.runId)).toEqual(["run-2", "run-1"]);
  });

  it("counts moved and failed operations per run", async () => {
    const journal = new Journal(new MemoryFileSystem({}), posixPath, "/lib");
    await journal.append(entry({ runId: "run-1", outcome: "moved" }));
    await journal.append(entry({ runId: "run-1", outcome: "copied", from: "/a/b.stl" }));
    await journal.append(entry({ runId: "run-1", outcome: "failed", from: "/a/c.stl" }));

    const runs = await journal.listRuns();
    expect(runs[0]).toMatchObject({ runId: "run-1", moved: 2, failed: 1 });
  });

  it("writes each entry as it arrives rather than buffering", async () => {
    const fs = new MemoryFileSystem({});
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());
    expect(await fs.readLines(JOURNAL_PATH)).toHaveLength(1);
  });
});
