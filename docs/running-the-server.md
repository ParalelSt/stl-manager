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
| `STL_ACCESS` | `local` | Who can reach it: `local`, `lan`, or `remote` |
| `STL_HOST` | from `STL_ACCESS` | Override the address to listen on |
| `STL_TRUST_PROXY` | `false` | Believe the address a proxy reports. Required for `remote` |
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

## Who can reach it

Three settings, in increasing order of exposure, so each step is a decision
rather than a default.

- **`local`** answers only the machine it runs on. The default, so a fresh
  install is not on your network by accident.
- **`lan`** answers your local network. What the Docker image sets, since a
  container answering only its own loopback would be unreachable from the host.
- **`remote`** is the same as `lan`, and additionally declares that a tunnel is
  in front. It refuses to start without `STL_TRUST_PROXY=true`, because without
  a proxy every request looks like it comes from the same address and the limit
  on failed tokens protects nobody.

The server says which one it is using when it starts:

```
STL Manager listening on 127.0.0.1:8080
Reachable from: this machine only. Set STL_ACCESS=lan to open it up.
```

Setting `remote` opens no ports and configures no tunnel. Use Cloudflare Tunnel
or Tailscale Funnel for that; both connect outward, so nothing is opened on your
router.

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
