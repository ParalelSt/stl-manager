# Running the server

The server is the same sorter as the desktop application, running headlessly in
a container and driven from a browser. It uses the same engine, so the sorting
rules, the duplicate handling and the undo journal all behave identically.

## Starting it

Copy `docker-compose.example.yml` to `docker-compose.yml`, edit the volumes to
match your machine, then:

```
docker compose up -d
docker compose logs
```

The log prints an access token the first time it starts. Paste that into the
browser once and it will be remembered.

```
STL Manager listening on port 8080
Access token: 7f3a9c2e...
Serving: /data
```

Open `http://localhost:8080`, or the machine's address from another computer on
your network.

## Container paths are not host paths

This is the single most common source of confusion, so it is worth stating
plainly. Inside the container the server can only see the paths you mounted.
Given this:

```yaml
volumes:
  - /home/me/downloads:/data/downloads
  - /home/me/stl-library:/data/library
```

the folder you choose in the interface is `/data/downloads`, not
`/home/me/downloads`. The directory browser only ever offers real container
paths, so following it rather than typing a path avoids the problem entirely.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `STL_ROOTS` | none, required | Colon-separated absolute paths the server may read and write |
| `PORT` | `8080` | Port to listen on |
| `STL_CONFIG_DIR` | `/config` | Where the access token is kept |
| `PUID` | `1000` | User id the server runs as |
| `PGID` | `1000` | Group id the server runs as |

The server refuses to start without `STL_ROOTS`. There is no default, on
purpose: a server that fell back to reading everything it could see would be
one mistake away from reorganising a whole machine.

Nothing outside `STL_ROOTS` can be read or written, whatever a request asks
for. Paths are resolved through the filesystem before being checked, so neither
`..` nor a symbolic link can be used to step outside them.

## File ownership

Run `id -u` and `id -g` on the host and put those numbers in `PUID` and `PGID`.
The container then writes as you, so the sorted library belongs to you rather
than to root.

Only the config directory has its ownership adjusted at startup. The mounted
collections are deliberately left alone: recursively changing ownership of a
large library would take a very long time and is not the application's
business.

## The access token

Generated on first start and stored in the config volume. Every request needs
it, apart from the `/health` endpoint a container healthcheck uses.

To issue a new one, delete `config/token` and restart. Any browser holding the
old token will ask for the new one.

There are no user accounts. The token is the whole of the access control, which
is appropriate for a service on your own network and is why phase 4 will handle
exposure beyond it properly rather than treating this as sufficient.

## One run at a time

A library can only have one apply or undo running at once, and a second request
is refused rather than queued. Two runs writing to one journal would interleave
their entries, and undo replays that journal backwards, so interleaved entries
would make an undo incoherent.

## Long operations

Scanning a large collection takes minutes. The interface starts the work, then
watches it, so closing the tab or losing the connection does not stop it. Come
back and the run is still going, or already finished.

If the server restarts mid-run, progress reporting is lost but nothing else is:
the journal inside the library records each move as it happens, so the run can
still be undone.

## Checking the image yourself

```
npm run test:container -w apps/server
```

Builds the image, sorts a small fixture inside it against host volumes, and
checks both the resulting layout and that the files came out owned by you. It
is the only test that can catch a permission or ownership mistake.
