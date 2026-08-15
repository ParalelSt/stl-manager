# STL Manager: Server and Docker Design

Date: 2026-08-15
Status: approved, not yet implemented
Scope: phase 2 of 5

## Purpose

Run the sorter headlessly in a container, controlled from a browser, so it
works on Linux as well as macOS. The engine, the sorting rules, and the safety
guarantees are unchanged: this phase adds a second way to reach them.

It also does the groundwork the networking phases depend on. Phase 3 needs
machines to talk over HTTP, phase 4 exposes that beyond the LAN, and phase 5
adds a remote storage backend. Each becomes an extension of what is built here
rather than a rewrite.

## What phase 1 left in place

Three seams make this phase an addition rather than a restructuring.

- The engine is a library with no UI and no direct filesystem access. It works
  through the `FileSystem` port, so nothing about it is specific to Electron.
- The renderer never imports the engine. It calls `StlManagerApi`, a named set
  of six operations. Supplying a second implementation of that interface is
  the whole of what "run it in a browser" requires.
- Plan editing is already pure and lives in the engine, so the browser gets
  rename, merge, split and exclude without any of it being reimplemented.

## Decisions

Settled during design. The rest of the document assumes them.

| Question | Decision |
| --- | --- |
| Authentication | A bearer token, required from the first release |
| Choosing paths | A directory browser in the interface, restricted to mounted volumes |
| The desktop app | Kept, sharing one interface package with the browser |
| Long operations | A job model: start, stream progress, fetch the result separately |
| Server framework | Hono on Node |
| Progress transport | Server-Sent Events |
| Out of scope | User accounts, TLS, multiple libraries, scheduled scans |

## Architecture

```
packages/core          the engine. unchanged by this phase
packages/contracts     request and response schemas, shared by every client
packages/ui            the screens. no Electron, no Node, no server

apps/desktop           Electron. supplies an IPC transport
apps/server            Node and Hono. supplies an HTTP transport, runs in Docker
```

`packages/ui` depends on a `Transport`, which is the `StlManagerApi` interface
phase 1 defined. It never learns which one it has.

It does import the engine, but only its pure half: `deriveMoves` and the plan
editors, which are ordinary functions over plain data. That is why phase 1 split
the package into a default entry point and a separate `@stl-manager/core/node`
entry holding `NodeFileSystem`. The interface can import the first and can never
reach the second, which is what makes the same screens bundle for a browser.

```
        packages/ui  ---- imports ----> @stl-manager/core
             |                          (pure planning only)
      Transport interface
        /            \
   IpcTransport   HttpTransport
        |               |
   Electron IPC      fetch + SSE
        |               |
     engine          apps/server -> engine
   + core/node            + core/node
```

### Why the contracts move

The Zod schemas in `apps/desktop/src/shared/ipc.ts` currently describe the IPC
boundary. They describe exactly the same requests over HTTP, so they move to
`packages/contracts` and both transports validate against them. One definition
means a change to a request shape cannot compile against one transport and
silently break the other.

## The job model

A scan or an apply runs for minutes. Holding a request open for that long fails
in ordinary conditions: a laptop sleeps, wifi drops, a proxy times out. Phase 4
makes those conditions normal rather than unlucky.

Work is therefore started, watched, and collected as three separate exchanges.

```
POST /api/scans            -> 202 { jobId }
GET  /api/jobs/:id/events  -> SSE stream of progress
GET  /api/jobs/:id         -> the job's state, and its result once finished
```

The stream is disposable. Dropping it does not touch the job, and reconnecting
rejoins the same one. A job that finishes while nobody is listening keeps its
result, so closing the tab during an apply and returning later works.

### Job lifecycle

A job is `running`, then `succeeded` or `failed`. Results are held in memory and
discarded thirty minutes after completion. Nothing about a job is durable: the
durable record of what happened to files is the journal in the library, which
phase 1 already writes as the work happens. A server restart therefore loses
progress reporting but never loses the ability to undo.

Jobs are kept per library. A job identifier is a random UUID and is not
guessable, but it is not a capability either: every request still needs the
token.

## API

Every route below `/api` requires `Authorization: Bearer <token>`. `/health`
does not, so a container healthcheck needs no secret.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness. No authentication |
| GET | `/api/roots` | The mounted volumes the server may read |
| GET | `/api/directories?path=` | Immediate subdirectories of a path |
| POST | `/api/scans` | Start a scan and plan. Returns a job |
| POST | `/api/applies` | Start an apply. Returns a job |
| POST | `/api/undos` | Start an undo. Returns a job |
| GET | `/api/jobs/:id` | Job state, and result when finished |
| GET | `/api/jobs/:id/events` | Progress as Server-Sent Events |
| GET | `/api/runs?libraryRoot=` | Past runs from the library's journal |

The plan itself is not held on the server. The client receives it, edits it,
and sends the resulting moves back with the apply request, exactly as the
desktop app does today. This keeps the server stateless between operations and
means two browsers cannot silently edit each other's plan.

## Safety

The token is the least interesting of the three protections here.

### Path confinement

Every path in every request is resolved to an absolute real path, following
symlinks, and checked to be inside one of the mounted roots. Requests naming
anything else are refused. This is applied at the edge, in one place, and it is
the reason the directory browser cannot be turned into a filesystem browser for
the whole container.

Symlinks matter specifically: a link inside a mounted volume pointing at `/etc`
would otherwise escape confinement. The scanner already refuses to follow
symlinks, but the directory browser and the path validator must refuse too.

### One apply at a time

A library may have one apply or undo in flight at a time, enforced by a lock
held for the duration. Two concurrent runs writing to one journal would
interleave their entries and make undo incoherent, which would quietly destroy
the guarantee the whole application rests on.

A second request while the lock is held is refused with a clear message naming
the running job, rather than queued.

### Token handling

Generated on first start, stored in the config volume with restrictive
permissions, and printed to the log once. It is compared in constant time.
Regenerating it means deleting the file and restarting.

## Docker

One image, multi-stage. The build stage compiles the engine, the interface and
the server; the runtime stage carries only production dependencies and the
built output.

Built for `linux/amd64` and `linux/arm64`, since the two machines this is for
are an Apple Silicon Mac and an x86 Linux PC.

The process runs as a non-root user. Because the files it sorts belong to the
host user, the image takes `PUID` and `PGID` and adjusts the runtime user to
match, which is the convention self-hosted images already use and the reason
sorted files come out owned by you rather than by root.

```yaml
services:
  stl-manager:
    image: ghcr.io/paralelst/stl-manager:latest
    ports:
      - "8080:8080"
    environment:
      PUID: 1000
      PGID: 1000
    volumes:
      - /home/me/models:/data/models
      - /home/me/downloads:/data/downloads
      - /home/me/stl-library:/library
      - ./config:/config
```

Mounted volumes are the only paths the server will touch. There is no
configuration that widens this, deliberately.

## The interface in a browser

The screens are identical. Three differences follow from the environment rather
than from choice.

- Choosing a folder opens the directory browser instead of a native dialog.
- Paths shown are container paths. The setup screen states which host folder
  each mounted root corresponds to, since that mapping is the single most
  common source of confusion with containers.
- A running job is rejoined on load, so refreshing during an apply returns to
  the progress screen rather than to setup.

## Error handling

Errors keep the shape phase 1 established: an operation returns a result
carrying either a value or a reason, and problems within an operation are
collected rather than thrown. The HTTP layer adds the cases a network
introduces.

- A refused request answers with a status and a message meant to be read by a
  person, not a stack trace.
- A dropped event stream is reconnected by the client with backoff.
- A job that fails records why, and the client shows it on the screen the user
  was already on.

## Testing

The engine is unchanged and its 172 tests still cover the rules. New tests
cover what this phase adds.

- The job registry: progress reaching several listeners, a listener joining
  late, a job outliving every listener, and results expiring.
- The path guard: traversal with `..`, absolute paths outside the roots,
  symlinks pointing outside, and paths that do not exist. This gets the most
  hostile tests in the phase.
- Authentication: a missing token, a wrong token, and `/health` without one.
- The apply lock: a second apply refused while one runs, and the lock released
  after both success and failure.
- One end-to-end test that drives a real sort through the HTTP API against a
  temporary directory and then undoes it, mirroring `realWorld.test.ts`.

The container itself is verified by building the image and running a sort
inside it against a mounted fixture, which is the only way to catch permission
and ownership mistakes.

## What this phase does not do

No user accounts, no TLS termination, no support for more than one library, and
no scheduled or automatic scanning. Exposure beyond the LAN is phase 4, and
doing TLS here would mean managing certificates for a service that currently
only answers on a home network.

Peer discovery and catalogue sharing are phase 3 and get their own design.
