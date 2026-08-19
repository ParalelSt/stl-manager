# Sharing with other people

A share is a link you send someone. It shows them the files you picked, lets
them download those files, and optionally lets them send a file back. It gives
them nothing else.

## Making a share

In the application, open **Share**. Tick the files you want, name the link,
choose whether it expires and whether the recipient may send files back, and
press Share. The link appears immediately, and existing links are listed
underneath with a Revoke next to each.

The desktop application can make and revoke links, but only a running server can
serve them: a link is an address, and the desktop app has none. Make links there
if you want them reachable.

Or over the API:

```
POST /api/shares
{
  "paths": ["/data/library/kit/kit_base.stl"],
  "label": "Vacuum kit",
  "allowsUpload": false,
  "expiresInMs": 604800000
}
```

The response carries a token. The link is `https://your-address/s/<token>`.

## What the recipient gets

A single page listing the files, with a download for each. No navigation, no
sight of your library, and no way to find another share.

They need no account and no password. The secret is the link itself, so treat
it as you would a password: anyone who has it has the files.

## What a share cannot do

- It cannot reach any other share, even with a valid link.
- It cannot reach the library, the peers, or any other part of the API.
- A file is named in the link by an identifier belonging to that share, so
  there is no path in a URL for anyone to manipulate.
- A wrong link, a revoked link and an expired link all answer identically, so a
  link cannot be probed to learn whether it once existed.

## Expiry and revoking

Every share expires, seven days by default. A share that never expires is
possible but has to be asked for, because a link that lives forever is a link
that leaks eventually.

Revoking is immediate, and deletes nothing but the share record. The files stay
where they are.

## Uploads

**Off unless you ask for it.** Set `allowsUpload` when creating the share.

When it is on, the page gains an upload control, and files sent to it land in a
folder of their own under the drop directory. That is the only way anything
from outside can write to your disk, so it is bounded deliberately:

- Only the file types the application already handles. It is not a file host.
- 512 MB per file, and 2 GB per share in total, by default.
- Filenames are reduced to a bare name and sanitised. A name like
  `../../etc/passwd` lands as `passwd`, inside the drop folder.
- A collision is numbered, never overwritten.
- Nothing is executed, and the drop folder is never served back out.

**Nothing sorts an upload.** It sits in the drop folder until you scan that
folder yourself and go through the ordinary review. Your library is untouched
until you say so.

## Reaching your machine from outside

The application does not manage a tunnel, and deliberately holds no credentials
for one. Use Cloudflare Tunnel or Tailscale Funnel to give the server an
address, both of which connect outward so nothing is opened on your router.

Do not port-forward directly unless you understand what you are exposing. The
share routes are designed to be reachable by strangers; the rest of the API is
protected only by its token.

## Guessing a token

Repeated failed authentication from one address is refused with a 429 and a
`Retry-After`, so a token cannot be guessed at speed. The block applies to the
correct token as well while it lasts, since answering differently would tell an
attacker which guess was right.

A forwarded-for header is believed only when `STL_TRUST_PROXY=true` is set. With
it off, a caller cannot claim a fresh address on every attempt and evade the
limit entirely. Set it when the server genuinely sits behind a tunnel or proxy,
and not otherwise.

Public share links are deliberately not rate limited. They carry their secret in
the URL and are meant for strangers; limiting them would let one person deny
everyone else a file you shared.
