# STL Manager

Finds 3D model files scattered across your machine and moves them into one
structured library. Models that share a name share a folder. Models that share
a purpose sit together under a shared parent folder.

Nothing is moved until you have reviewed exactly what would happen, and every
run can be reversed.

## Status

Phase 1 of 5: the sorter, running on a single machine. Networking, Docker,
peer sharing and Google Drive are planned but not built. See
`docs/design/2026-08-15-sorter-design.md`.

## How the sorting works

**Grouping by name.** A file's name is normalised before it is compared:
lowercased, with underscores, hyphens and dots treated as spaces, and any
duplicate marker removed. So `Space_Marine.stl`, `space marine.stl` and
`Space-Marine (2).stl` are all the same model.

A trailing number is only treated as a duplicate marker when it is in
parentheses, or follows the word `copy`. `tower 2.stl` keeps its number,
because a bare trailing number is far more often part of a model's name than a
sign of duplication.

**Grouping by purpose.** A group is placed under a shared parent folder named
after the folder its files came from, but only when that folder held two or
more distinct models. A folder holding a single model is not a category, it is
just where that model happened to sit.

```
Library/
  Terrain/                 the source folder held several models
    Ruined Tower/
      ruined_tower.stl
    Barricade/
      barricade.stl
  Space Marine/            this model stood alone in its folder
    space_marine.stl
  _Duplicates/             copies set aside, never deleted
```

**Duplicates.** Where several files share a name, the highest duplicate number
wins, and the newest file breaks a tie. Before any file is set aside it is
compared against the winner by content: first by size, then by both ends of the
file, then by a full hash. Files that turn out to differ are not duplicates at
all, whatever their names suggest, so they are kept side by side and flagged.

Losing copies move to `_Duplicates` inside the library, under a path mirroring
where they came from. Nothing is ever deleted. Empty that folder yourself once
you trust the results.

**Companion files.** Images, readmes and slicer files travel with a model when
they sit in the same folder and share its name, or when their folder maps to
exactly one model. Otherwise they are left alone and listed in the report.
They are never collected on their own.

## What it collects

- Meshes: `.stl`, `.obj`, `.3mf`, `.step`, `.stp`, `.ply`
- Slicer and pre-supported files: `.lys`, `.lychee`, `.chitubox`, `.ctb`
- Companions, only alongside a model: `.jpg`, `.jpeg`, `.png`, `.webp`,
  `.txt`, `.pdf`, `.md`

System folders, application bundles, `node_modules`, `.git` and the library
itself are always skipped.

## Undo

Every completed operation is appended to a journal inside the library at
`.stl-manager/journal.jsonl`, flushed as the work happens rather than at the
end. A run interrupted by a crash or a power cut is therefore still fully
reversible.

Undo replays that journal backwards. It never overwrites: if something already
occupies a file's original location, that file is reported and skipped rather
than replacing what is there.

## Running it

Requires Node 22 or newer.

```
npm install
npm run build
npm run dev -w apps/desktop
```

If Electron starts but no window appears, check whether your terminal exports
`ELECTRON_RUN_AS_NODE`. Some editors set it, and it makes Electron run as plain
Node. The npm scripts unset it.

## Licence

MIT.
