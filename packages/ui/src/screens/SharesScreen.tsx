import { buildLibraryTree, posixPath, type TreeFolder, type TreeNode } from "@stl-manager/core";
import { useMemo, useState } from "react";
import { Button, BUTTON_TONE } from "../components/Button.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useShares } from "../hooks/useShares.js";
import { useAppStore } from "../store.js";
import { formatBytes, plural } from "../text.js";

/** Every file in a tree, which is what a share is made from. */
function filesIn(node: TreeNode): { path: string; name: string; size: number }[] {
  if (node.kind === "file") {
    return [{ path: node.path, name: node.name, size: node.size }];
  }
  return node.children.flatMap((child) => filesIn(child));
}

function formatWhen(at: number | undefined): string {
  if (at === undefined) {
    return "never expires";
  }
  return `expires ${new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

export function SharesScreen() {
  const { shares, error, isWorking, lastCreated, create, revoke, back } = useShares();
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const plan = useAppStore((state) => state.plan);

  const [label, setLabel] = useState("");
  const [allowsUpload, setAllowsUpload] = useState(false);
  const [expires, setExpires] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  /**
   * What can be shared.
   *
   * Taken from the plan when there is one, since that is what the user has
   * been looking at. Without a plan there is nothing to offer, which the
   * screen says rather than showing an empty list.
   */
  const available = useMemo(() => {
    if (plan === undefined) {
      return [];
    }
    const tree: TreeFolder = buildLibraryTree(plan, posixPath).root;
    return filesIn(tree);
  }, [plan]);

  const toggle = (path: string): void => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-4 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const linkNote =
    lastCreated === undefined ? null : (
      <div className="border-border bg-surface mt-6 border p-4">
        <p className="text-muted text-xs tracking-wide uppercase">The link</p>
        <p className="mt-2 font-mono text-sm break-all">/s/{lastCreated}</p>
        <p className="text-muted mt-3 text-sm">
          Put your server&apos;s address in front of that. Anyone with the link has the files, so
          treat it as you would a password.
        </p>
      </div>
    );

  const picker =
    available.length === 0 ? (
      <p className="text-muted py-8 text-sm">
        Nothing to share yet. Scan a folder first, and the models will appear here.
      </p>
    ) : (
      <ul className="border-border divide-border max-h-72 divide-y overflow-y-auto border-y">
        {available.map((file) => (
          <li key={file.path}>
            <label className="hover:bg-surface flex cursor-pointer items-center gap-3 px-2 py-2.5">
              <input
                type="checkbox"
                checked={chosen.has(file.path)}
                onChange={() => {
                  toggle(file.path);
                }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.name}</span>
              <span className="text-muted text-xs tabular-nums">{formatBytes(file.size)}</span>
            </label>
          </li>
        ))}
      </ul>
    );

  const existing =
    shares.length === 0 ? (
      <p className="text-muted py-8 text-sm">No links made yet.</p>
    ) : (
      <ul className="border-border border-t">
        {shares.map((share) => (
          <li
            key={share.id}
            className="border-border flex flex-wrap items-center justify-between gap-4 border-b py-4"
          >
            <div className="min-w-0">
              <p className="text-base">{share.label}</p>
              <p className="text-muted mt-1 text-sm">
                {plural(share.fileCount, "file")} · {formatWhen(share.expiresAt)}
                {share.allowsUpload ? " · accepts uploads" : ""}
              </p>
              <p className="text-muted mt-1 font-mono text-xs break-all">/s/{share.token}</p>
            </div>
            <Button
              tone={BUTTON_TONE.QUIET}
              onClick={() => {
                void revoke(share.id);
              }}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto max-w-5xl px-10 pt-16 pb-24">
      <header className="grid grid-cols-12 gap-x-8">
        <div className="col-span-12 md:col-span-8">
          <h1 className="font-serif text-5xl leading-tight">Share with someone</h1>
          <p className="text-muted mt-4 max-w-prose">
            Pick some files and get a link. Whoever opens it sees only those files and nothing else
            about your library. Links expire after a week unless you say otherwise, and you can
            revoke one at any time.
          </p>
          {errorNote}
        </div>
      </header>

      <section className="mt-12 max-w-2xl">
        <h2 className="font-serif text-2xl">New link</h2>
        <div className="mt-6">{picker}</div>

        <label className="mt-6 block">
          <span className="text-muted text-xs tracking-wide uppercase">Name</span>
          <input
            value={label}
            placeholder="Vacuum kit"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            className="border-border focus:border-accent placeholder:text-muted mt-2 w-full border-b bg-transparent pb-2 text-sm focus:outline-none"
          />
        </label>

        <div className="mt-6 space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={expires}
              onChange={(event) => {
                setExpires(event.target.checked);
              }}
            />
            Expires after a week
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={allowsUpload}
              onChange={(event) => {
                setAllowsUpload(event.target.checked);
              }}
            />
            Let them send files back
          </label>
          <p className="text-muted max-w-prose text-xs">
            Uploads land in a drop folder and are never sorted into your library on their own. You
            scan that folder yourself when you want them.
          </p>
        </div>

        <div className="mt-8">
          <Button
            tone={BUTTON_TONE.PRIMARY}
            disabled={isWorking || chosen.size === 0}
            onClick={() => {
              void create(
                [...chosen],
                label === "" ? "Shared files" : label,
                allowsUpload,
                expires,
              );
            }}
          >
            {isWorking ? "Making the link" : `Share ${plural(chosen.size, "file")}`}
          </Button>
        </div>
        {linkNote}
      </section>

      <section className="mt-14">
        <h2 className="font-serif text-2xl">Existing links</h2>
        <div className="mt-4">{existing}</div>
      </section>

      <footer className="mt-14">
        <Button onClick={back}>Back</Button>
      </footer>
      {libraryRoot === undefined ? null : <span className="sr-only">{libraryRoot}</span>}
    </div>
  );
}
