# STL Manager: Google Drive Design

Date: 2026-08-15
Status: approved, not yet implemented
Scope: phase 5 of 5

## Purpose

Pull models out of a Google Drive folder into the library, sorted by the same
rules as everything else.

Drive is treated as another peer: something you browse and take copies from. It
is not a library the application sorts into, and nothing is ever written to it.

## Decisions

| Question | Decision |
| --- | --- |
| Role | A source to pull from. Read-only, never written to |
| Where files land | The same staging folder peers use, then an ordinary sort |
| Credentials | Yours, supplied once; the application holds no client secret of its own |
| Scope requested | `drive.readonly`, and nothing wider |
| Out of scope | Uploading to Drive, syncing, Shared Drives, Docs conversion |

## Why read-only

The application cannot write to Drive, by construction rather than by
restraint: it asks for the `drive.readonly` scope, so the token it holds is
incapable of modifying anything. A bug in this code cannot damage a Drive.

That also makes the consent screen honest. A user granting access is granting
exactly what the screen says.

## Credentials

Google has no way for a self-hosted application to authenticate without the
person running it creating an OAuth client. There is no shortcut, and shipping
a shared client secret in an open-source repository would be both against
Google's terms and pointless, since the secret would not be secret.

So the setup is: create a Google Cloud project, enable the Drive API, create an
OAuth client of type Desktop, and give the application its client id and
secret. The documentation walks through it.

The application then runs the loopback flow: it opens a browser to Google's
consent screen, receives the code on a local port, exchanges it for a refresh
token, and stores that in the config volume beside the other tokens. The
refresh token is the only credential kept, and it is only ever exchanged for
short-lived access tokens.

Revoking is done at Google, or by deleting the stored credential.

## Browsing

A Drive folder is presented as a catalogue, the same `TreeFolder` shape a peer
returns, so the interface reuses the tree it already has.

Drive's model differs from a filesystem in ways that matter:

- A file has an identifier, not a path, and can have several parents. The
  catalogue therefore reports Drive identifiers, and the pull asks for those,
  which is the same shape the share links already use.
- Names are not unique within a folder. Two files called `tower.stl` in one
  folder are ordinary, so the pull numbers collisions exactly as it does for a
  peer.
- Google Docs formats have no bytes to download. They are filtered out rather
  than exported, since a spreadsheet is not a model.

Only the extensions the scanner already collects are listed. A Drive folder
with ten thousand photos in it produces an empty catalogue rather than ten
thousand rows.

## Pulling

Identical to pulling from a peer, and reusing the same code path: files are
fetched into the staging folder, named from their Drive names after
sanitisation, written to a temporary name and renamed on completion.

Nothing about a Drive response is trusted to build a path with. A file named
`../../etc/passwd` arrives as `passwd`, in staging.

Downloads are streamed and resumable requests are not attempted; a failed file
is reported and the rest continue, as with peers.

## Rate limits and failure

Drive rate-limits and occasionally fails a request that will succeed on retry.
A request that fails with a retryable status is retried a few times with
increasing delay, and then reported. A pull of many files is deliberately
sequential rather than parallel: finishing slowly is better than being told to
go away half way through.

## Testing

The Drive API is reached through one small client with a single `fetch`
dependency, injected. Every test drives that with recorded shapes of real Drive
responses, which means the tests are honest about what the code does with a
given answer, without being able to prove Google sends that answer.

- Listing: only collected extensions survive, Docs formats are dropped, and
  paging is followed to the end.
- Token handling: an expired access token is refreshed once and the request
  retried; a refresh failure is reported rather than looping.
- Pulling: a hostile name lands sanitised inside staging, a failed file does
  not stop the rest, and nothing partial is left behind.
- Retries: a retryable status is retried, a non-retryable one is not.

**This is the one phase that cannot be verified end to end here**, because it
needs a real Google account and OAuth client. The client is written against the
published API and covered by tests at the seam, and that gap is stated in the
documentation rather than glossed over.

## What this phase does not do

No uploading to Drive, no synchronisation, no Shared Drive support, and no
conversion of Google formats. Those are all reasonable later work; none of them
is what was asked for.
