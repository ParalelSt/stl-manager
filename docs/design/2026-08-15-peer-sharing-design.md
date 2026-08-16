# STL Manager: Peer Sharing Design

Date: 2026-08-15
Status: approved, not yet implemented
Scope: phase 3 of 5

## Purpose

Let two machines that each hold their own library see what the other has, and
bring a model across when you want it. Both machines run the server from phase
2; neither is in charge.

Nothing about sorting changes. A pulled model arrives as ordinary files and is
then sorted by the same scan, review and apply the user already knows, so it
lands where their own rules put it rather than where the other machine put it.

## What phases 1 and 2 left in place

- The server already exposes the engine over HTTP, already authenticates, and
  already confines every path. Peers are new routes on it, not a new program.
- `readLibraryTree` already produces a tree of a library on disk. That is the
  catalogue, so peers exchange a shape both ends already understand.
- The apply journal already makes every move reversible, so a pull that ends in
  a normal apply is reversible for free.

## Decisions

| Question | Decision |
| --- | --- |
| Topology | Both machines run the server; peers, not client and host |
| Finding each other | Paste an address and a token once; no discovery |
| Trust | A separate read-only share token, not the machine's own token |
| Pulling | Files land in a staging folder, then sort through the normal flow |
| Direction | Pull only. A peer can never push into your library |
| Out of scope | Automatic sync, conflict resolution, discovery, sharing with strangers |

## Two tokens, not one

The access token from phase 2 is the whole of that machine's authority: anything
holding it can scan, apply and undo. Handing that to another machine so it can
read a catalogue would give it the ability to reorganise the library.

So pairing uses a second token, generated alongside the first and stored beside
it, which is accepted only on the two routes a peer needs:

```
GET /api/share/catalogue        what this machine holds
GET /api/share/file?path=       the bytes of one file
```

Both are read-only. There is no route a share token can reach that writes
anything, which is the property that makes it safe to hand out, and the reason
phase 4 can extend the same mechanism to people who are not you.

## Pairing

A peer is added once, by pasting its address and its share token. The server
verifies the pair immediately by fetching the peer's catalogue, so a typo fails
at the moment you make it rather than later.

Paired peers are stored in the config volume, next to the tokens. A peer record
holds an identifier, a label, the address, and the share token needed to read
from it. Removing a peer forgets the record; it does not tell the other machine
anything, because there is nothing to tell.

```
POST   /api/peers          pair with a machine
GET    /api/peers          list paired machines
DELETE /api/peers/:id      forget one
GET    /api/peers/:id/catalogue    what that machine holds
POST   /api/peers/:id/pulls        fetch models from it
```

Everything above needs the machine's own token, because it is the owner acting.
Only the two `/api/share` routes accept a share token.

## The catalogue

A peer's catalogue is its library tree: the same `TreeFolder` the interface
already renders, so browsing a peer reuses the component built in the library
browser rather than a second one.

It is fetched on demand rather than mirrored. A catalogue that was cached would
be a second source of truth to keep in step, and the whole point of the design
is that neither machine owns the other's state.

## Pulling

Pulling is a job, like scanning and applying, because it is slow for the same
reasons.

1. The user picks a folder or files from the peer's catalogue.
2. The server fetches each file from the peer's `/api/share/file` route.
3. Files land in a staging directory, preserving the peer's folder names.
4. Nothing else happens automatically.

The user then runs a normal scan with the staging directory as a scan root, and
the files are grouped, deduplicated and filed by their own rules. Two useful
things follow. A model the user already has is recognised as a duplicate by
content and quarantined rather than added twice. And the move into the library
is journalled, so a pull is as undoable as anything else.

The staging directory defaults to `_Incoming` beside the library, and must sit
inside the configured roots but outside the library itself, since the scanner
refuses to scan the library.

### Transfers

Files are streamed rather than read into memory, since a mesh can be very
large. Each file is written to a temporary name and renamed into place once
complete, so an interrupted pull leaves no half a file that a later scan would
treat as real.

A pull that fails part way through keeps what it already fetched and reports
what it did not. Re-running it skips files already present with a matching size,
which makes retrying cheap and safe.

## Safety

Everything phase 2 established still applies, and the new surface adds three
things.

**A peer is not trusted about paths.** A catalogue arrives as data from another
machine, so any path in it is treated as untrusted input: the file route on the
serving side confines the requested path to its own library, and the pulling
side builds destination paths itself from the file names rather than from
anything the peer supplied. A peer that returned `../../etc/passwd` as a name
gets a refused request, not a written file.

**Pull only.** There is no route by which a peer writes anything on your
machine. That removes the whole class of problems where the other end decides
what lands in your library.

**A share token grants reading, not doing.** It is checked on its own routes
only, and those routes cannot move, delete or sort anything.

## Interface

The library browser gains a peer selector. Choosing a peer shows its catalogue
in the same tree, marked as remote and read-only, with a control to pull the
selected folder or file. A setup screen lists paired machines and offers the
address and token fields to add another.

After a pull, the interface says plainly what arrived and offers to scan the
staging directory, which is the ordinary flow from there on.

## Testing

- Pairing: a good pair, a wrong token, an unreachable address, a duplicate pair,
  and forgetting one.
- The share routes: a share token is accepted on them, the machine token is too,
  and a share token is refused everywhere else. This is the most important test
  in the phase.
- Path confinement across the boundary: a peer serving a path outside its
  library, and a catalogue containing a name designed to escape.
- Transfers: a large file streamed rather than buffered, an interrupted pull
  leaving no partial file in place, and a re-run skipping what it already has.
- One end-to-end test running two servers against separate temporary libraries,
  pairing them, pulling a model, sorting it, and confirming the pulling side
  ends up with it and the serving side still has it.

## What this phase does not do

No automatic synchronisation, no conflict resolution, and no deletion
propagating between machines. No discovery. No sharing with anyone who is not
you: that is phase 4, which extends the share token rather than replacing it.
