import {
  JOB_STATE,
  type JobEnvelope,
  type OperationResult,
  type ProgressEvent,
} from "@stl-manager/contracts";
import type { Transport } from "@stl-manager/ui/transport";

/** What the transport needs to reach the server. */
export interface HttpTransportOptions {
  /** Where the API lives, for example "" for the same origin. */
  baseUrl: string;
  token: string;
  /** Injected so tests can drive a Hono app without opening a socket. */
  fetch?: typeof globalThis.fetch;
}

/** How often a running job is polled while it is being watched. */
const POLL_INTERVAL_MS = 400;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Talks to the server over HTTP.
 *
 * The job model is hidden entirely. Callers see the same promise-returning
 * operations the desktop application has, and this turns each one into a
 * started job, a watched stream, and a fetched result. That is what lets one
 * set of screens run in both places without knowing which it is in.
 *
 * @param options - Where the server is and how to authenticate
 * @returns A transport the interface can be given
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch;
  const listeners = new Set<(progress: ProgressEvent) => void>();

  function url(path: string): string {
    return `${options.baseUrl}${path}`;
  }

  async function request<Value>(
    path: string,
    init?: RequestInit,
  ): Promise<OperationResult<Value>> {
    try {
      const response = await doFetch(url(path), {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
      });
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "ok" in body) {
        return body as OperationResult<Value>;
      }
      return { ok: false, error: `The server answered with status ${response.status}.` };
    } catch (error) {
      // A network failure is a normal outcome over HTTP, not an exception the
      // interface should have to catch.
      return { ok: false, error: describeError(error) };
    }
  }

  function announce(progress: ProgressEvent): void {
    for (const listener of listeners) {
      listener(progress);
    }
  }

  /**
   * Watches a job to completion, announcing progress as it goes.
   *
   * Polling rather than an event stream: a dropped stream would need its own
   * reconnection logic, whereas a poll that fails simply happens again. The
   * stream endpoint remains for clients that want it.
   */
  async function awaitJob<Value>(jobId: string): Promise<OperationResult<Value>> {
    for (;;) {
      const job = await request<JobEnvelope<Value>>(`/api/jobs/${jobId}`);
      if (!job.ok) {
        return job;
      }
      const envelope = job.value;
      if (envelope.progress !== undefined) {
        announce(envelope.progress);
      }
      if (envelope.state === JOB_STATE.SUCCEEDED) {
        return { ok: true, value: envelope.result as Value };
      }
      if (envelope.state === JOB_STATE.FAILED) {
        return { ok: false, error: envelope.error ?? "The job failed." };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  async function startAndAwait<Value>(
    path: string,
    body: unknown,
  ): Promise<OperationResult<Value>> {
    const started = await request<{ jobId: string }>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!started.ok) {
      return started;
    }
    return awaitJob<Value>(started.value.jobId);
  }

  return {
    listRoots: () => request("/api/roots"),
    listDirectories: (request_) =>
      request(`/api/directories?path=${encodeURIComponent(request_.path)}`),
    buildPlan: (body) => startAndAwait("/api/scans", body),
    applyPlan: (body) => startAndAwait("/api/applies", body),
    undoRun: (body) => startAndAwait("/api/undos", body),
    listRuns: (body) =>
      request(`/api/runs?libraryRoot=${encodeURIComponent(body.libraryRoot)}`),

    readLibrary: (body) =>
      request(`/api/library?libraryRoot=${encodeURIComponent(body.libraryRoot)}`),

    listPeers: () => request("/api/peers"),
    addPeer: (body) => request("/api/peers", { method: "POST", body: JSON.stringify(body) }),
    removePeer: (id) => request(`/api/peers/${id}`, { method: "DELETE" }),
    peerCatalogue: (id) => request(`/api/peers/${id}/catalogue`),
    pullFromPeer: ({ peerId, ...body }) =>
      startAndAwait(`/api/peers/${peerId}/pulls`, body),

    // A browser has no file manager to reveal anything in, so this is a no-op
    // rather than a missing method: the interface can call it unconditionally.
    revealInFinder: async () => ({ ok: true, value: undefined }),

    onProgress: (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
