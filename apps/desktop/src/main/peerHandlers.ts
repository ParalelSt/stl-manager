import { posixPath, type TreeFolder } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { createPeerRegistry, pullFromPeer, type Peer } from "@stl-manager/server";
import type { OperationResult } from "@stl-manager/contracts";
import electron from "electron";
import { app } from "electron";

const { ipcMain } = electron;
const fs = new NodeFileSystem();

/** Where the desktop application keeps paired machines. */
function configDir(): string {
  return app.getPath("userData");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Asks a peer for its catalogue, which also proves a pairing is real. */
async function fetchCatalogue(
  peer: Pick<Peer, "baseUrl" | "shareToken" | "libraryRoot">,
): Promise<TreeFolder> {
  const url = `${peer.baseUrl}/api/share/catalogue?libraryRoot=${encodeURIComponent(peer.libraryRoot)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${peer.shareToken}` } });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    throw new Error(`That machine answered with status ${response.status}.`);
  }
  const result = body as OperationResult<TreeFolder>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

/**
 * Registers the peer operations for the desktop application.
 *
 * The desktop app is a peer like any other: it can read another machine and
 * pull from it. It does not serve a catalogue itself, because it is not always
 * running and has no address to be reached at.
 */
export function registerPeerHandlers(): void {
  const peers = () => createPeerRegistry(fs, posixPath, configDir());

  ipcMain.handle("listPeers", async () => {
    const known = await peers().list();
    return {
      ok: true,
      value: known.map(({ shareToken: _shareToken, ...rest }) => rest),
    };
  });

  ipcMain.handle("addPeer", async (_event, request: unknown) => {
    const record: Record<string, unknown> =
      typeof request === "object" && request !== null ? { ...request } : {};
    const baseUrl = record["baseUrl"];
    const shareToken = record["shareToken"];
    const libraryRoot = record["libraryRoot"];
    const label = record["label"];

    if (
      typeof baseUrl !== "string" ||
      typeof shareToken !== "string" ||
      typeof libraryRoot !== "string"
    ) {
      return { ok: false, error: "An address, a share token and a library are all required." };
    }

    const candidate = { baseUrl: baseUrl.replace(/\/+$/, ""), shareToken, libraryRoot };
    try {
      await fetchCatalogue(candidate);
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }

    const added = await peers().add({
      ...candidate,
      label: typeof label === "string" && label !== "" ? label : candidate.baseUrl,
    });
    const { shareToken: _hidden, ...safe } = added;
    return { ok: true, value: safe };
  });

  ipcMain.handle("removePeer", async (_event, id: unknown) => {
    if (typeof id !== "string") {
      return { ok: false, error: "A peer is required." };
    }
    await peers().remove(id);
    return { ok: true, value: undefined };
  });

  ipcMain.handle("peerCatalogue", async (_event, id: unknown) => {
    if (typeof id !== "string") {
      return { ok: false, error: "A peer is required." };
    }
    const peer = await peers().get(id);
    if (peer === undefined) {
      return { ok: false, error: "No such peer." };
    }
    try {
      return { ok: true, value: await fetchCatalogue(peer) };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });

  ipcMain.handle("pullFromPeer", async (_event, request: unknown) => {
    const record: Record<string, unknown> =
      typeof request === "object" && request !== null ? { ...request } : {};
    const peerId = record["peerId"];
    const stagingDir = record["stagingDir"];
    const paths = record["paths"];

    if (typeof peerId !== "string" || typeof stagingDir !== "string" || !Array.isArray(paths)) {
      return { ok: false, error: "A peer, a staging folder and a list of files are required." };
    }
    const peer = await peers().get(peerId);
    if (peer === undefined) {
      return { ok: false, error: "No such peer." };
    }

    try {
      const result = await pullFromPeer({
        peer,
        paths: paths.filter((entry): entry is string => typeof entry === "string"),
        stagingDir,
        fs,
        path: posixPath,
        fetch: globalThis.fetch,
      });
      return { ok: true, value: result };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });
}
