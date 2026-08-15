# STL Manager: Sorter Design

Date: 2026-08-15
Status: approved, not yet implemented
Scope: phase 1 of 5

## Purpose

STL Manager finds 3D model files scattered across a machine and moves them into
a single structured library. Models that share a name share a folder. Models
that share a purpose sit under a shared parent folder, one subfolder per name.
Duplicate copies are resolved to a single winner and the rest are quarantined
rather than deleted.

This document covers phase 1: the sorting engine and the desktop application,
on one machine, with no networking. Later phases are outlined at the end and
will each get their own design document.

## Roadmap

The full project is five phases. Each is built on its own branch and merged to
main once it works.

1. Sorter. Engine plus Electron desktop app. Single machine, no network.
2. Server and Docker. HTTP API over the engine, Docker image, browser UI.
3. Peer sharing. LAN discovery, catalogue publishing, browse and pull.
4. Remote access. Access from outside the LAN, upload portal, share links.
5. Google Drive. Drive as a remote the library can push to and pull from.

Phase 1 makes four decisions specifically so the later phases do not require a
rewrite:

- The engine is a library with no UI and no filesystem assumptions.
- All filesystem work goes through a port interface, so a remote peer or Drive
  can implement the same interface later.
- The library has an explicit catalogue representation from day one, because
  that is the object peers will exchange in phase 3.
- The UI talks to a defined operation surface rather than calling the engine
  directly, so phase 2 replaces the transport instead of the application.

## Decisions

These were settled during design and the rest of the document assumes them.

| Question | Decision |
| --- | --- |
| Application form | Electron desktop app, TypeScript throughout |
| File action | Move into one library folder chosen by the user |
| Purpose detection | Inferred from source folder name, editable before applying |
| Duplicate losers | Quarantined in the library, never deleted |
| Duplicate detection | Verified by content hash, not by filename suffix alone |
| File types | Mesh files and slicer files collected; images and readmes only travel alongside a model |
| Licence | MIT |

## Architecture

An npm workspaces monorepo with two packages.

```
packages/core     engine. pure TypeScript, no Electron, no UI
apps/desktop      Electron main process, preload, React renderer
```

### The filesystem port

`core` never imports `node:fs`. It depends on a `FileSystem` interface
providing `list`, `stat`, `move`, `copy`, `hash`, `remove`, and `mkdir`. Two
implementations exist in phase 1:

- `NodeFileSystem`, used by the application.
- `MemoryFileSystem`, used by tests.

This keeps the engine's tests fast and free of real file operations, and it is
the seam that phase 3 and phase 5 extend.

### Pipeline

Four stages. Each consumes the previous stage's output and is inspectable on
its own. Only the last stage writes to disk.

```
scan  ->  group  ->  plan  ->  apply
```

## Scan

Walks the configured roots and produces an inventory. Writes nothing.

For each file it records the absolute path, the stem, the extension, size,
modification time, creation time, the source directory, and the duplicate
suffix if the name carries one.

### Roots

The user chooses scan roots. The default is the home directory.

### Exclusions

The scanner hard-skips the following, and the list is not user-editable because
including any of them causes damage or nonsense results:

- The library destination and its quarantine folder, so a rescan cannot consume
  its own output.
- System directories.
- Application bundles.
- `node_modules`, `.git`, and other tooling directories.

Symbolic links are recorded but never followed, which avoids both cycles and
moving a file that only appears to live where the link sits.

### Collected extensions

- Mesh files: `.stl`, `.obj`, `.3mf`, `.step`, `.stp`, `.ply`
- Slicer and pre-supported files: `.lys`, `.lychee`, `.chitubox`, `.ctb`
- Companions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.txt`, `.pdf`, `.md`

Companions are never collected on their own. They are only ever moved as
described under Companion files below. Without that restriction the scan would
sweep up unrelated documents from across the machine.

## Group

Turns the inventory into groups.

### Name key

A file's name key is derived from its stem:

1. Lowercase.
2. Strip a trailing duplicate suffix: `(1)`, `(12)`, ` copy`, ` copy 2`.
3. Collapse `_`, `-`, and `.` to single spaces.
4. Trim and collapse repeated whitespace.

Files sharing a name key belong to the same group and end up in the same
folder. The group's display name is the most common original stem among its
members, so the library reads naturally rather than showing normalised keys.

### Purpose

A group's purpose is the name of the source directory its files came from,
subject to one rule:

> A directory only becomes a purpose if it contributed two or more distinct
> name keys.

A directory holding a single model is not a category, it is just where that
model happened to sit. Without this rule the library fills with purpose folders
containing exactly one child, which is worse than no purpose folders at all.

When a group's files come from several directories, the purpose is taken from
the directory contributing the most files. Ties are broken by the directory
holding the newest file.

### Resulting layout

```
Library/
  Terrain/                  purpose: source folder held several models
    Ruined Tower/
      ruined_tower.stl
    Barricade/
      barricade.stl
  Space Marine/             no purpose: model stood alone
    space_marine.stl
  _Duplicates/              quarantine, mirrors original paths
```

## Duplicates

Duplicate candidates are files within a group that share a name key and an
extension.

### Winner selection

Per the original requirement: the highest duplicate suffix wins, and where
suffixes tie or are absent, the newest file by creation time wins. Creation
time falls back to modification time on filesystems that do not record it.

### Content verification

Before any file is treated as a discardable copy, its contents are compared
against the winner:

1. Compare size. Different size means different file.
2. Compare the first and last 64KB.
3. Compute a full hash only when the above match.

Files that are byte-identical to the winner are quarantined. Files that differ
are not duplicates at all, regardless of what their names suggest. They are
kept side by side in the group folder, their original suffix preserved to keep
names unique, and flagged in the review so the user can decide.

This deliberately goes beyond the original requirement. Selecting by filename
alone would silently discard a genuinely different model that happened to share
a name, which is unrecoverable in a way that keeping an extra file is not.

### Quarantine

Losers move to `_Duplicates/` inside the library, under a path mirroring their
original location, so their origin remains obvious. Nothing is ever deleted by
the application. The user empties the folder once they trust the results.

## Companion files

A companion moves only when both of the following hold:

- It sits in the same directory as a model that is being moved.
- Its stem matches that model's name key.

If a companion matches no model but its directory maps to exactly one group, it
follows that group. Otherwise it is left in place and listed in the report as
untouched.

## Plan

The plan is a list of proposed operations. Each carries a source path, a
destination path, the group it belongs to, and a reason: model, companion, or
duplicate. Nothing has been written at this point.

The plan is what the user reviews and edits. Supported edits:

- Rename a group.
- Merge two groups.
- Split a group.
- Change or clear a group's purpose.
- Exclude a group or an individual file.

Editing the plan re-derives destinations. It never re-runs the scan.

## Apply

Executes the plan.

### Preflight

Before the first write:

- Re-stat every source file and confirm size and modification time match the
  scan. Anything changed is dropped from the run and reported.
- Confirm the destination has enough free space.
- Resolve destination collisions, including collisions that only exist on
  case-insensitive filesystems.

### Execution

Operations run sequentially. Each is attempted as a rename first. When the
filesystem refuses because the destination is on another volume, the operation
falls back to copy, verify the copied size, then unlink, in that order, so the
source is never removed before the copy is confirmed. Any other rename failure
is recorded rather than retried, since it means something is wrong beyond the
move itself.

The fallback is driven by what the filesystem reports rather than by comparing
device identifiers beforehand. The operating system is the authority on whether
a rename can cross a given boundary, and asking it costs nothing extra in the
common case where the rename simply succeeds.

A file that fails does not abort the run. The failure is recorded and execution
continues. One unreadable file must not stop ten thousand moves.

### Journal

Every completed operation is appended to a JSONL journal in the library,
flushed per operation. Each entry records the operation, source, destination,
timestamp, and outcome.

Undo replays the journal backwards, moving files to their original locations.
Because the journal is written as work completes rather than at the end, an
apply interrupted by a crash or a power cut is still fully undoable.

## Error handling

Errors are collected, not thrown at the user one at a time. Each stage produces
a result plus a list of problems, and the UI shows them together at the end of
the stage. Unreadable directories, permission failures, and files that vanished
mid-run are all expected conditions, not exceptions.

## Interface

Five screens.

1. Setup. Choose the library destination and the scan roots.
2. Scan progress. Live count, current path, cancellable.
3. Review. The grouped tree, editable, with duplicates and conflicts surfaced.
4. Apply progress. Per-operation progress and a running failure count.
5. History. Past runs and undo.

Review is the screen that matters. It has to make several thousand grouped
files scannable, so it favours density and clear hierarchy over decoration.

### Visual direction

Following `rules/frontend-design.mdc`, which takes precedence over `DESIGN.md`:

- Seven-colour palette declared in `tokens.ts`: background, surface, text,
  muted text, border, primary, accent. The accent is ochre.
- IBM Plex Sans for UI and body, IBM Plex Serif for headings.
- Flat buttons, no shadow, `rounded-md` at most, never `rounded-2xl`.
- Asymmetric layout, generous spacing, no centred hero.

## Testing

Test-driven throughout, using Vitest.

Grouping, duplicate resolution, and planning are pure functions and are tested
against `MemoryFileSystem`. Cases that must be covered:

- Unicode and emoji in filenames.
- Case-insensitive collisions, since macOS and Linux disagree here.
- Duplicate suffixes in several forms, including nested ones.
- Directories with one model, which must not become purposes.
- Same-named files with different contents, which must both survive.
- Permission failures and unreadable directories.

The applier and the journal are tested against real temporary directories,
because the cross-volume fallback and recovery from an interrupted run cannot
be simulated meaningfully in memory.

## Out of scope for phase 1

Networking of any kind, Docker, Google Drive, share links, mesh parsing or
thumbnail rendering, and any persistent index or database. The scan result is
written as a plain file, which can be replaced with a database later without
the UI noticing.
