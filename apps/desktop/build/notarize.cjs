/**
 * Sends the signed application to Apple for notarisation.
 *
 * Credentials are never stored in this repository. The build reads them from a
 * notarytool keychain profile, which is created once by the person doing the
 * release:
 *
 *   xcrun notarytool store-credentials stl-manager \
 *     --apple-id <apple id> --team-id <team id>
 *
 * When that profile is absent the build signs but does not notarise, and says
 * so. A build that failed obscurely at the last step would be far worse than
 * one that tells you what is missing.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const KEYCHAIN_PROFILE = process.env.STL_NOTARY_PROFILE || "stl-manager";

function hasCredentials() {
  try {
    execFileSync("xcrun", ["notarytool", "history", "--keychain-profile", KEYCHAIN_PROFILE], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);

  if (!hasCredentials()) {
    console.log(
      [
        "",
        `  Skipping notarisation: no notarytool keychain profile called "${KEYCHAIN_PROFILE}".`,
        "  The application is signed and will run on this machine, but macOS will",
        "  warn anyone else who opens it. To notarise, run once:",
        "",
        `    xcrun notarytool store-credentials ${KEYCHAIN_PROFILE} \\`,
        "      --apple-id <your apple id> --team-id <your team id>",
        "",
      ].join("\n"),
    );
    return;
  }

  console.log("  Notarising. This is a round trip to Apple and usually takes a few minutes.");
  const { notarize } = await import("@electron/notarize");
  await notarize({ appPath, keychainProfile: KEYCHAIN_PROFILE, tool: "notarytool" });
  console.log("  Notarised and stapled.");
};
