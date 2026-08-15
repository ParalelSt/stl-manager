# Packaging the desktop application

Produces a signed, notarised `STL Manager.app` in a `.dmg`, for both Apple
Silicon and Intel Macs.

```
npm run package -w apps/desktop
```

The result lands in `apps/desktop/release/`.

## Signing

The build signs with whichever `Developer ID Application` certificate is in
your keychain. Check you have one:

```
security find-identity -v -p codesigning
```

Signing uses the hardened runtime, which macOS requires for notarisation.
Electron needs a few entitlements to run under it, and those are checked in at
`apps/desktop/build/entitlements.mac.plist`: the JIT and unsigned-memory
permissions V8 needs, and read and write access to folders the user picks in a
dialog.

## Notarising

Notarisation is Apple confirming the application is not malware. Without it
macOS warns anyone who opens the app on a machine other than the one that built
it.

It needs an app-specific password, which is never kept in this repository. Run
this once, on the machine that does releases:

```
xcrun notarytool store-credentials stl-manager \
  --apple-id <your apple id> --team-id <your team id>
```

It asks for the password and stores it in your keychain under the name
`stl-manager`. The build reads it from there. Create an app-specific password at
appleid.apple.com, under Sign-In and Security; it is not your Apple ID password.

Set `STL_NOTARY_PROFILE` to use a different profile name.

When the profile is missing the build signs but does not notarise, prints what
is missing, and carries on. A build that failed obscurely at the final step
would be worse than one that tells you why.

Notarisation is a round trip to Apple. It usually takes a few minutes, and the
first one for a new application can take longer.

## Checking the result

```
codesign --verify --deep --strict --verbose=2 "apps/desktop/release/mac-arm64/STL Manager.app"
spctl -a -vvv -t install "apps/desktop/release/mac-arm64/STL Manager.app"
```

`spctl` reporting `rejected` with `source=Unnotarized Developer ID` means the
signature is fine and only notarisation is missing. After a notarised build it
reports `accepted` with `source=Notarized Developer ID`.

## The icon

`apps/desktop/build/icon.icns`, generated from an SVG using the application's
own palette. To change it, edit the SVG in the build script, or replace the
`.icns` with your own artwork at 1024 by 1024.
