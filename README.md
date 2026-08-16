# STL Manager

Finds 3D model files scattered across your machine and moves them into one
structured library. Models that share a name share a folder. Models that share
a purpose sit together under a shared parent folder.

Nothing is moved until you have reviewed exactly what would happen, and every
run can be reversed.

## Status

All five phases are built: the sorter, a server that runs the same sorter in a
container with a browser interface, sharing between two machines, share links
for other people, and pulling from Google Drive.

The Drive integration is the one part not exercised against the real service,
because that needs your own Google OAuth client. See `docs/google-drive.md`. See the
documents in `docs/design/`.

## How the sorting works

**Grouping into families.** Models whose names begin with the same word belong
together, applied so that a whole family collects even when its members only
share their opening. The folder takes the longest run of words every member has
in common, so it names itself.

```
Library/
  kit/                     kit_base, kit_lip, kit_straight
  vacuum_adapter/          six models sharing that opening
  2853/                    2853_fixed, 2853_hole_plus_0p20...
```

Each model keeps its own filename. Only the folder is named after the family,
because a family holds several distinct models rather than several copies of
one.

**Numbered sets.** Files numbered in a run within one folder are recognised as
a set even though their names share no word, since `01_adapter` through
`08_filter_cone` is plainly one kit. The set takes its folder's name, or is
labelled `Numbered set` for you to rename when that folder's name says nothing
useful.

**Shared parent folders.** A family sits under a parent named after the folder
its files came from, but only when that folder held two or more families and
its name actually describes something. Folders called `Downloads`, `Desktop`,
`Models` or `Unsorted` never become categories: they say where a file landed,
not what it is.

**Names.** A file's name is normalised before it is compared: lowercased, with
underscores, hyphens and dots treated as spaces, and any duplicate marker
removed. A trailing number counts as a duplicate marker only in parentheses or
after the word `copy`, so `tower 2.stl` keeps its number.

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

## Running the desktop application

Requires Node 22 or newer.

```
npm install
npm run build
npm run dev -w apps/desktop
```

If Electron starts but no window appears, check whether your terminal exports
`ELECTRON_RUN_AS_NODE`. Some editors set it, and it makes Electron run as plain
Node. The npm scripts unset it.

## Sharing between two machines

Both machines run the server, pair once with an address and a read-only share
token, and either can then browse the other and copy models across. Pulled files
are sorted by the receiving machine's own rules. See
`docs/sharing-between-machines.md`.

## Sharing with other people

Pick some files and get a link. The recipient sees only those files, with a
download for each, and can optionally send a file back into a drop folder that
never touches your library. Links expire and can be revoked. See
`docs/sharing-with-people.md`.

## Google Drive

Connect a Drive and pull models out of it into your library, sorted by your own
rules. Read-only: the application asks for a scope that cannot change anything
in your Drive. Setting it up needs your own Google OAuth client. See
`docs/google-drive.md`.

## Building a Mac application

```
npm run package -w apps/desktop
```

Produces a signed `STL Manager.app` in a `.dmg` under `apps/desktop/release/`,
for both Apple Silicon and Intel. Notarising it as well takes one extra setup
step, described in `docs/packaging-the-app.md`.

## Running the server

```
cp docker-compose.example.yml docker-compose.yml
# edit the volumes to match your machine
docker compose up -d
docker compose logs
```

The log prints an access token on first start. Open `http://localhost:8080`,
paste it once, and the browser remembers it.

Note that the folders you choose in the browser are container paths such as
`/data/downloads`, not host paths. See `docs/running-the-server.md` for volumes,
file ownership, and the rest.

## Licence

MIT.
