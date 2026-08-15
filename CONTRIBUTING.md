# Contributing

## Layout

```
packages/core     the engine. pure TypeScript, no UI, no Electron
apps/desktop      Electron main process, preload bridge, React renderer
docs/design       design documents, one per phase
```

## Getting set up

Requires Node 22 or newer.

```
npm install
npm run build
npm test
```

## The rule that matters most

`packages/core` must never import `node:fs`.

The engine reaches the disk only through the `FileSystem` interface in
`fileSystem.ts`. `NodeFileSystem` implements it for the running application and
`MemoryFileSystem` implements it for tests, which is why the engine's tests
move no real files and run in milliseconds. It is also the seam that later
phases extend, when a remote machine or a cloud drive implements the same
interface.

This is enforced by lint, not by convention, so a violation fails the build.
`nodeFileSystem.ts` is the single exemption.

The renderer follows the same principle: it has no filesystem access and never
imports the engine's Node entry point. Everything it can do is listed in
`StlManagerApi` in `apps/desktop/src/renderer/src/bridge.ts`.

## The pipeline

Four stages, each a function of the last, and only the final one writes:

```
scan  ->  group  ->  plan  ->  apply
```

`planner.ts` produces a `PlanModel`, which the review screen edits, and
`deriveMoves` turns that model into the actual list of moves. Destinations are
derived rather than stored, so renaming a group cannot leave stale paths behind.

There is a test asserting that planning writes nothing at all. Keep it.

## Testing

Run `npm test` for everything, or `npm test -w packages/core` for the engine.

- Engine logic is tested against `MemoryFileSystem`.
- `nodeFileSystem.test.ts` and `pipeline.test.ts` use real temporary
  directories, because cross-volume moves and interrupted runs cannot be
  simulated meaningfully in memory.
- `libraryShape.test.ts` asserts the shape of a whole library rather than one
  path at a time. It exists because every individual path can look correct
  while the library as a whole reads badly.

After building the desktop app, `npm run smoke -w apps/desktop` loads the real
renderer in a hidden window and checks the preload bridge, context isolation
and the stylesheet. Unit tests cannot cover any of that.

## Style

Project rules live in `Claude rules/`, which is not committed. In short:

- Strict TypeScript. No `any`, and no `as` assertions to work around a type
  error.
- `interface` for object shapes, `as const` objects instead of `enum`.
- JSDoc on exported functions, types and constants. Not on internal helpers.
- React: plain function declarations, no logic in JSX, no inline conditional
  rendering, no inline SVG.
- Comments explain why, not what.

Run `npm run build && npm run lint` before opening a pull request. Both must
pass.

## Branches

Work happens on a branch and merges to `main` once it works. Commit messages
are a single short line.

Markdown files whose names contain `spec` or `plan` are deliberately excluded
from the repository.
