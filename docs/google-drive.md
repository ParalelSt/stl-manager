# Google Drive

Drive is treated as another peer: somewhere you browse and take copies from.
The application never writes to it.

## What it can and cannot do

It asks Google for the `drive.readonly` scope, so the credential it holds is
**incapable** of changing anything in your Drive. That is a property of the
token, not a promise about the code: a bug here cannot damage a Drive.

It also means the consent screen is honest about what it is asking for.

## Setting it up

Google has no way for a self-hosted application to authenticate without you
creating an OAuth client. There is no shortcut, and shipping a shared secret in
an open-source repository would be both against Google's terms and pointless,
since it would not be secret.

1. Go to console.cloud.google.com and create a project.
2. Enable the **Google Drive API** for it.
3. Under **APIs and Services**, configure the OAuth consent screen. External is
   fine; add your own account as a test user.
4. Create credentials, choose **OAuth client ID**, type **Desktop app**.
5. Note the client id and client secret.
6. Obtain a refresh token for the `drive.readonly` scope, using Google's
   OAuth Playground or your own loopback flow.
7. Give the application all three:

```
PUT /api/drive
{ "clientId": "...", "clientSecret": "...", "refreshToken": "..." }
```

The credential is stored in the config volume. Only the refresh token is kept;
short-lived access tokens are fetched from it as needed and never written down.

The application never returns the credential once stored. Asking about the
Drive tells you only whether one is connected.

## Browsing and pulling

```
GET  /api/drive/catalogue?folderId=<id>
POST /api/drive/pulls  { "stagingDir": "...", "files": [{ "id": "...", "name": "..." }] }
```

Only file types the scanner already collects are listed, so a Drive folder full
of photos produces an empty catalogue rather than thousands of rows. Google's
own formats are skipped, since a spreadsheet is not a model.

Pulled files land in the staging folder and are then sorted by the ordinary
scan, review and apply, exactly as models pulled from another machine are. The
move into your library is journalled and undoable.

## Disconnecting

```
DELETE /api/drive
```

That forgets the stored credential. To revoke access entirely, remove the
application at myaccount.google.com under Security, Third-party access.

## What is not built

No uploading to Drive, no synchronisation, no Shared Drive support, and no
conversion of Google formats.

## An honest limitation

This is the one part of the application that has **not been exercised against
the real service**, because that needs a Google account and an OAuth client
that only you can create. The client is written against the published Drive API
and is covered by tests at the seam, driven with recorded shapes of Drive
responses. Those prove what the code does with a given answer; they cannot
prove Google sends that answer.

Expect to hit at least one small surprise the first time you connect a real
Drive.
