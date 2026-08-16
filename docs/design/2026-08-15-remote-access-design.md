# STL Manager: Remote Access and Sharing Design

Date: 2026-08-15
Status: approved, not yet implemented
Scope: phase 4 of 5

## Purpose

Reach your own machines from outside your network, and give another person a
link to a model without giving them anything else.

This is the first phase where something other than you can reach the
application, so most of it is about what cannot happen rather than what can.

## Decisions

| Question | Decision |
| --- | --- |
| Exposure | An outbound tunnel. Nothing is opened on the router |
| Share links | A read-only page for exactly what was shared |
| Uploads | Allowed, per link, off by default |
| Link secrecy | A long random token per share, revocable, optionally expiring |
| Out of scope | User accounts, payments, anything resembling a public service |

## Exposure

The application does not manage the tunnel. It has no business holding
credentials for Cloudflare or Tailscale, and a tunnel that the app could
misconfigure is worse than one the user set up deliberately.

What the application does instead is behave correctly once it is reachable:

- It trusts `X-Forwarded-For` only from a configured proxy address, so a
  request cannot claim to come from somewhere else.
- It refuses to start with remote access enabled unless a tunnel or proxy is
  declared, so nobody accidentally exposes a server that assumed a LAN.
- Failed authentication is rate limited per address. A sixty-four character
  token is not guessable, but an endpoint that answers a million attempts a
  second is still a mistake.

Documentation covers Cloudflare Tunnel and Tailscale Funnel, because those are
what the two machines here would actually use.

## Share links

A share is a named selection of files, a token, and some limits.

```
GET  /s/:token              the page, no authentication
GET  /s/:token/file?id=     one file from that share
POST /s/:token/upload       only when the share allows it
```

These are the only unauthenticated routes in the application, and they can
reach nothing except the share they belong to. A share token is not a share
token in general: it names one share, and that share names its files.

Managing shares needs the machine's own token, as everything else does:

```
POST   /api/shares          create
GET    /api/shares          list
DELETE /api/shares/:id      revoke
```

### What a share holds

The files are recorded by path when the share is made. A share is therefore a
snapshot: adding a model to the library later does not add it to an existing
share, which is the behaviour that cannot surprise anyone.

Every share has an expiry, defaulting to seven days. An unlimited share is
possible but must be asked for, because a link that lives forever is a link
that leaks eventually.

Revoking is immediate and deletes nothing but the share record.

## Uploads

This is the part that deserves the most care, since it is the only way anything
outside can write to your disk.

**Off unless asked for.** A share allows uploads only when it was created that
way. The default is a share that cannot be written to at all.

**Into a drop folder, never the library.** Uploads land in a per-share folder
under a configured drop directory. Nothing sorts them, nothing moves them, and
the library is untouched until you scan the drop folder yourself and go through
the ordinary review.

**Bounded.** A share carries a maximum file size and a maximum total, both with
conservative defaults. When either is reached the upload is refused and the
share stops accepting more.

**Names are never trusted.** An uploaded filename is reduced to a bare name and
sanitised, exactly as a peer's filenames are in phase 3. Collisions are
numbered, never overwritten.

**Only file types the application already handles.** The same extension list the
scanner uses. This is not a general file host.

**Nothing is executed, ever.** Files are written and read as bytes. The server
never runs anything it received, and the drop folder is not served back out.

## The portal page

Served by the same server, at `/s/:token`, and deliberately plain: the shared
files, their sizes, a download control, and an upload control when the share
allows one. No navigation into anything else, no mention of the library, and no
way to discover another share.

It reuses the interface's palette and typography so it looks like the rest of
the application, but it is a separate page rather than the main interface,
because the main interface assumes an owner and this one has none.

## Safety summary

The three properties this phase must not break:

1. An unauthenticated request can reach exactly one share and nothing else.
2. A share cannot be written to unless it was created to allow it, and even
   then only into a drop folder that no automatic process reads.
3. Nothing that arrives from outside is trusted as a path, a name, or a size.

Each has tests written before the code.

## Testing

- Share tokens: a valid one reaches its own share, a valid one cannot reach a
  different share, an expired one is refused, a revoked one is refused, and an
  invented one is refused.
- Uploads: refused on a share that does not allow them, refused past the size
  cap, refused past the total cap, refused for an extension not on the list,
  and a hostile filename lands as a sanitised name inside the drop folder.
- The drop folder never receives anything outside itself, tested with the same
  traversal cases as the peer pull.
- Rate limiting: repeated failures from one address are slowed.
- One end-to-end test creating a share, fetching it as an anonymous client,
  uploading to it, and confirming the file arrived in the drop folder and the
  library is unchanged.

## What this phase does not do

No accounts, no per-recipient permissions, no notifications. No public
directory of shares. Google Drive is phase 5.
