/** Everything the server needs to know before it starts. */
export interface ServerConfig {
  port: number;
  /** The only directories the server will ever read or write. */
  roots: string[];
  /** Where the token and any future state are kept. */
  configDir: string;
  /** Where files uploaded to a share land. Never inside a library. */
  dropDir: string;
  /**
   * Whether a proxy in front of this server may be believed about who is
   * calling.
   *
   * Off by default. With it off, a request cannot claim to come from somewhere
   * else by setting a header, which would otherwise defeat rate limiting
   * entirely.
   */
  trustProxy: boolean;
  /**
   * Which addresses the server answers on.
   *
   * Local only by default, so a fresh install is reachable from the machine it
   * runs on and nowhere else. Opening it up is a deliberate act.
   */
  host: string;
  /**
   * Whether this server is meant to be reachable from outside the network.
   *
   * Turning it on relaxes nothing by itself. It exists so the server can say
   * plainly what it is doing at startup, and can refuse the combinations that
   * are almost certainly a mistake.
   */
  isRemote: boolean;
}

const DEFAULT_PORT = 8080;

/** Only this machine. */
const LOCAL_ONLY = "127.0.0.1";

/** Every address, which is what a container and a LAN server both need. */
const EVERYWHERE = "0.0.0.0";
const DEFAULT_CONFIG_DIR = "/config";
const LOWEST_PORT = 1;
const HIGHEST_PORT = 65535;

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < LOWEST_PORT || port > HIGHEST_PORT) {
    throw new Error(`PORT must be a whole number between ${LOWEST_PORT} and ${HIGHEST_PORT}.`);
  }
  return port;
}

/**
 * Reads the server's configuration from the environment.
 *
 * Refuses to start without roots. A server that defaulted to whatever it could
 * see would be one misconfiguration away from reorganising an entire host
 * filesystem, so the failure is deliberate and loud.
 *
 * @param env - The environment, passed in so this is testable
 * @returns The validated configuration
 * @throws when the configuration is missing or unusable
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const roots = (env["STL_ROOTS"] ?? "")
    .split(":")
    .map((root) => root.trim())
    .filter((root) => root !== "");

  if (roots.length === 0) {
    throw new Error(
      "STL_ROOTS must list at least one absolute directory, separated by colons.",
    );
  }

  for (const root of roots) {
    if (!root.startsWith("/")) {
      throw new Error(`Every path in STL_ROOTS must be absolute, but got "${root}".`);
    }
  }

  const configDir = env["STL_CONFIG_DIR"] ?? DEFAULT_CONFIG_DIR;

  // Three settings, in increasing order of exposure, so the step from one to
  // the next is a decision rather than a default.
  const access = env["STL_ACCESS"] ?? "local";
  if (!["local", "lan", "remote"].includes(access)) {
    throw new Error('STL_ACCESS must be "local", "lan" or "remote".');
  }
  const isRemote = access === "remote";

  if (isRemote && env["STL_TRUST_PROXY"] !== "true") {
    // Remote access is meant to arrive through a tunnel or proxy. Without one,
    // every request looks like it comes from the same address and the rate
    // limiting on failed tokens protects nobody.
    throw new Error(
      'STL_ACCESS=remote expects a tunnel or proxy in front of the server, so ' +
        "STL_TRUST_PROXY must be true. If you really are exposing this server " +
        'directly, use STL_ACCESS=lan and understand what that means.',
    );
  }

  return {
    port: parsePort(env["PORT"]),
    roots,
    configDir,
    // Beneath the config directory by default, which is a volume the user
    // already knows about and which no library ever lives in.
    dropDir: env["STL_DROP_DIR"] ?? `${configDir}/drops`,
    trustProxy: env["STL_TRUST_PROXY"] === "true",
    host: env["STL_HOST"] ?? (access === "local" ? LOCAL_ONLY : EVERYWHERE),
    isRemote,
  };
}
