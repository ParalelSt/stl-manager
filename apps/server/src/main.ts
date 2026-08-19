import { serve } from "@hono/node-server";
import { NodeFileSystem } from "@stl-manager/core/node";
import { posixPath } from "@stl-manager/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureShareToken, ensureToken } from "./token.js";

/** Says plainly who can reach this server, since it is easy to get wrong. */
function reachableBy(config: ReturnType<typeof loadConfig>): string {
  if (config.host === "127.0.0.1") {
    return "Reachable from: this machine only. Set STL_ACCESS=lan to open it up.";
  }
  if (config.isRemote) {
    return "Reachable from: outside your network, through your tunnel.";
  }
  return "Reachable from: your local network.";
}

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const fs = new NodeFileSystem();

  await fs.mkdir(config.configDir);
  const token = await ensureToken(fs, posixPath, config.configDir);
  const shareToken = await ensureShareToken(fs, posixPath, config.configDir);

  // The built interface sits beside the compiled server inside the image.
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-web");
  const app = createApp({ config, token, shareToken, fs, path: posixPath, webRoot });

  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    // Printed once, on purpose: this is the only place the token is shown, and
    // it is how the user gets it into their browser the first time.
    process.stdout.write(
      [
        "",
        `STL Manager listening on ${config.host}:${info.port}`,
        reachableBy(config),
        `Access token:  ${token}`,
        `Share token:   ${shareToken}   (read-only, give this to a paired machine)`,
        `Serving: ${config.roots.join(", ")}`,
        "",
      ].join("\n"),
    );
  });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not start: ${message}\n`);
  process.exitCode = 1;
});
