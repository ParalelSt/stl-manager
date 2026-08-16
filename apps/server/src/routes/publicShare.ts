import type { FileSystem, PathUtil } from "@stl-manager/core";
import { Hono } from "hono";
import { COLLECTED_EXTENSIONS } from "@stl-manager/core";
import type { Share, ShareRegistry } from "../shares.js";

/** What the public share routes need. */
export interface PublicShareOptions {
  shares: ShareRegistry;
  fs: FileSystem;
  path: PathUtil;
  /** Where uploads land. Never inside a library. */
  dropDir: string;
  now?: () => number;
}

/**
 * Reduces a name supplied by a stranger to something safe to write.
 *
 * Everything about an upload comes from outside, so the name is treated as a
 * suggestion rather than a path. Only the last segment survives, only
 * characters that cannot mean anything to a filesystem are kept, and the
 * result is bounded in length.
 */
export function sanitiseUploadName(supplied: string): string | undefined {
  const last = supplied.split(/[/\\]/).filter((part) => part !== "").at(-1);
  if (last === undefined || last === "." || last === "..") {
    return undefined;
  }
  const cleaned = last
    .replace(/\0/g, "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned === "" ? undefined : cleaned;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** The share as a stranger is allowed to see it. */
function publicView(share: Share) {
  return {
    label: share.label,
    files: share.files.map((file) => ({ id: file.id, name: file.name, size: file.size })),
    allowsUpload: share.allowsUpload,
    // The remaining allowance, so the page can say what it will accept. The
    // absolute totals are not interesting to a recipient.
    remainingBytes: Math.max(0, share.maxTotalBytes - share.uploadedBytes),
    maxUploadBytes: share.maxUploadBytes,
  };
}

/**
 * The only routes reachable without a token of this machine's own.
 *
 * Each one is scoped to a single share by the secret in its own URL. There is
 * no route here that can reach another share, the library, or anything else on
 * the machine.
 *
 * @param options - The registry, filesystem and drop folder
 * @returns The routes, mounted under /s
 */
export function publicShareRoutes(options: PublicShareOptions): Hono {
  const { shares, fs, path, dropDir } = options;
  const now = options.now ?? Date.now;
  const routes = new Hono();

  routes.get("/:token", async (context) => {
    const token = context.req.param("token");
    const share = await shares.byToken(token, now());
    if (share === undefined) {
      // A revoked, expired or invented link are deliberately indistinguishable.
      return context.html(notFoundPage(), 404);
    }
    return context.html(sharePage(token, publicView(share)));
  });

  routes.get("/:token/info", async (context) => {
    const share = await shares.byToken(context.req.param("token"), now());
    if (share === undefined) {
      return context.json({ ok: false, error: "That link is not available." }, 404);
    }
    return context.json({ ok: true, value: publicView(share) });
  });

  routes.get("/:token/file", async (context) => {
    const share = await shares.byToken(context.req.param("token"), now());
    if (share === undefined) {
      return context.json({ ok: false, error: "That link is not available." }, 404);
    }

    // A file is named by an identifier belonging to this share, never by a
    // path, so there is nothing for a caller to manipulate.
    const file = share.files.find((entry) => entry.id === context.req.query("id"));
    if (file === undefined) {
      return context.json({ ok: false, error: "That file is not in this share." }, 404);
    }

    let size: number;
    try {
      size = (await fs.stat(file.path)).size;
    } catch {
      return context.json({ ok: false, error: "That file is no longer available." }, 404);
    }

    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          let offset = 0;
          while (offset < size) {
            const chunk = await fs.readChunk(file.path, offset, 1024 * 1024);
            if (chunk.length === 0) {
              break;
            }
            controller.enqueue(chunk);
            offset += chunk.length;
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${file.name.replace(/"/g, "")}"`,
      },
    });
  });

  routes.post("/:token/upload", async (context) => {
    const share = await shares.byToken(context.req.param("token"), now());
    if (share === undefined) {
      return context.json({ ok: false, error: "That link is not available." }, 404);
    }
    if (!share.allowsUpload) {
      return context.json({ ok: false, error: "This link does not accept files." }, 403);
    }

    const form = await context.req.formData().catch(() => null);
    const uploaded = form?.get("file");
    if (!(uploaded instanceof File)) {
      return context.json({ ok: false, error: "A file is required." }, 400);
    }

    const name = sanitiseUploadName(uploaded.name);
    if (name === undefined) {
      return context.json({ ok: false, error: "That filename cannot be used." }, 400);
    }

    // Only the kinds of file this application already handles. It is not a
    // general file host, and accepting anything would make it one.
    if (COLLECTED_EXTENSIONS[extensionOf(name)] === undefined) {
      return context.json({ ok: false, error: "That kind of file is not accepted." }, 400);
    }

    if (uploaded.size > share.maxUploadBytes) {
      return context.json({ ok: false, error: "That file is too large." }, 413);
    }
    if (share.uploadedBytes + uploaded.size > share.maxTotalBytes) {
      return context.json({ ok: false, error: "This link has reached its limit." }, 413);
    }

    // Uploads land in a folder of their own, per share, and nothing reads it
    // automatically. The library is untouched until the owner scans it.
    const folder = path.join(dropDir, share.id);
    await fs.mkdir(folder);

    let destination = path.join(folder, name);
    for (let attempt = 2; await fs.exists(destination); attempt += 1) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      destination = path.join(folder, `${stem} (${attempt})${ext}`);
    }

    await fs.writeBytes(destination, new Uint8Array(await uploaded.arrayBuffer()));
    await shares.recordUpload(share.id, uploaded.size);

    return context.json({ ok: true, value: { name: path.basename(destination) } }, 201);
  });

  return routes;
}

/** Escapes text so a filename cannot become markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The page's own styling.
 *
 * Written out rather than bundled: this page is served to strangers, has no
 * application behind it, and should not depend on the interface build at all.
 * It follows the same palette so it still looks like the application.
 */
const PAGE_STYLE = `
  :root {
    --background: #faf9f6; --surface: #ffffff; --text: #1c1b18;
    --muted: #6b6862; --border: #dedbd2; --primary: #2b2a26; --accent: #b8860b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 4rem 1.5rem; background: var(--background); color: var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 2.5rem; margin: 0 0 .5rem; }
  p.lead { color: var(--muted); margin: 0 0 2.5rem; }
  ul { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--border); }
  li {
    display: flex; align-items: center; gap: 1rem; justify-content: space-between;
    padding: .9rem 0; border-bottom: 1px solid var(--border);
  }
  .name { font-family: ui-monospace, monospace; font-size: .85rem; overflow-wrap: anywhere; }
  .size { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }
  a.download, button {
    display: inline-block; background: var(--primary); color: var(--background);
    padding: .5rem 1rem; border: 0; border-radius: .375rem; font-size: .85rem;
    text-decoration: none; cursor: pointer; font-family: inherit;
  }
  a.download:hover, button:hover { background: var(--text); }
  section.upload { margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 2rem; }
  h2 { font-family: Georgia, serif; font-size: 1.4rem; margin: 0 0 .5rem; }
  input[type=file] { display: block; margin: 1rem 0; font-size: .85rem; }
  .note { color: var(--muted); font-size: .85rem; }
  .accent { color: var(--accent); }
`;

interface PublicShareView {
  label: string;
  files: { id: string; name: string; size: number }[];
  allowsUpload: boolean;
  remainingBytes: number;
  maxUploadBytes: number;
}

/** The page a recipient sees. Deliberately plain, and entirely self-contained. */
function sharePage(token: string, view: PublicShareView): string {
  const rows = view.files
    .map(
      (file) => `<li>
        <span class="name">${escapeHtml(file.name)}</span>
        <span style="display:flex;align-items:center;gap:1rem">
          <span class="size">${formatBytes(file.size)}</span>
          <a class="download" href="/s/${encodeURIComponent(token)}/file?id=${encodeURIComponent(file.id)}">Download</a>
        </span>
      </li>`,
    )
    .join("");

  const uploadSection = !view.allowsUpload
    ? ""
    : `<section class="upload">
        <h2>Send a file back</h2>
        <p class="note">
          Model and slicer files only, up to ${formatBytes(view.maxUploadBytes)} each,
          ${formatBytes(view.remainingBytes)} remaining in total.
        </p>
        <form method="post" action="/s/${encodeURIComponent(token)}/upload" enctype="multipart/form-data">
          <input type="file" name="file" required />
          <button type="submit">Upload</button>
        </form>
      </section>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(view.label)}</title>
<style>${PAGE_STYLE}</style>
</head><body><main>
<h1>${escapeHtml(view.label)}</h1>
<p class="lead">${view.files.length} ${view.files.length === 1 ? "file" : "files"} shared with you.</p>
<ul>${rows}</ul>
${uploadSection}
</main></body></html>`;
}

/** Shown for a link that is wrong, revoked or expired. All look the same. */
function notFoundPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Not available</title><style>${PAGE_STYLE}</style>
</head><body><main>
<h1>Not available</h1>
<p class="lead">That link has expired, been revoked, or never existed.</p>
</main></body></html>`;
}
