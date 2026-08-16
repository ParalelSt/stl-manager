/**
 * The parts of the server the desktop application reuses.
 *
 * The desktop app has no HTTP server, but peers are the same problem in both
 * places, so it drives these directly rather than growing a second
 * implementation that could drift.
 */
export { createPeerRegistry, type Peer, type PeerRegistry } from "./peers.js";
export { pullFromPeer, type PullOptions, type PullResult } from "./pull.js";
