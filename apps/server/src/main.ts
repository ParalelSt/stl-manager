import { serve } from "@hono/node-server";
import { NodeFileSystem } from "@stl-manager/core/node";
import { posixPath } from "@stl-manager/core";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureToken } from "./token.js";

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const fs = new NodeFileSystem();

  await fs.mkdir(config.configDir);
  const token = await ensureToken(fs, posixPath, config.configDir);

  const app = createApp({ config, token, fs, path: posixPath });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    // Printed once, on purpose: this is the only place the token is shown, and
    // it is how the user gets it into their browser the first time.
    process.stdout.write(
      [
        "",
        `STL Manager listening on port ${info.port}`,
        `Access token: ${token}`,
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
