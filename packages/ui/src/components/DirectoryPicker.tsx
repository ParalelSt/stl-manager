import type { DirectoryEntry, RootInfo } from "@stl-manager/contracts";
import { useCallback, useEffect, useState } from "react";
import { useHost } from "../host.js";
import { Button, BUTTON_TONE } from "./Button.js";
import { FolderIcon } from "./icons/FolderIcon.js";

interface Props {
  title: string;
  onChoose: (path: string | undefined) => void;
}

/**
 * The interface's own folder chooser.
 *
 * Used where there is no native dialog to open, which in practice means the
 * browser build. It can only walk the folders the server is willing to list,
 * so it is a chooser rather than a filesystem browser.
 */
export function DirectoryPicker({ title, onChoose }: Props) {
  const { transport } = useHost();

  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [current, setCurrent] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await transport.listRoots();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRoots(result.value);
      const only = result.value.length === 1 ? result.value[0] : undefined;
      if (only !== undefined) {
        setCurrent(only.path);
      }
    })();
  }, [transport]);

  useEffect(() => {
    if (current === undefined) {
      setEntries([]);
      return;
    }
    void (async () => {
      setIsLoading(true);
      const result = await transport.listDirectories({ path: current });
      setIsLoading(false);
      if (!result.ok) {
        setError(result.error);
        setEntries([]);
        return;
      }
      setError(undefined);
      setEntries(result.value);
    })();
  }, [current, transport]);

  const isAtRoot = roots.some((root) => root.path === current);

  const goUp = useCallback(() => {
    if (current === undefined || isAtRoot) {
      return;
    }
    const parent = current.slice(0, current.lastIndexOf("/"));
    setCurrent(parent === "" ? "/" : parent);
  }, [current, isAtRoot]);

  const rootList = (
    <ul className="border-border divide-border divide-y border-y">
      {roots.map((root) => (
        <li key={root.path}>
          <button
            type="button"
            onClick={() => {
              setCurrent(root.path);
            }}
            className="hover:bg-surface flex w-full items-center gap-3 px-2 py-2.5 text-left text-sm"
          >
            <FolderIcon className="text-muted h-4 w-4 shrink-0" />
            <span className="truncate">{root.label}</span>
            <span className="text-muted ml-auto truncate font-mono text-xs">{root.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const entryList = (() => {
    if (isLoading) {
      return <p className="text-muted py-10 text-sm">Reading.</p>;
    }
    if (entries.length === 0) {
      return <p className="text-muted py-10 text-sm">No folders in here.</p>;
    }
    return (
      <ul className="border-border divide-border max-h-80 divide-y overflow-y-auto border-y">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => {
                setCurrent(entry.path);
              }}
              className="hover:bg-surface flex w-full items-center gap-3 px-2 py-2.5 text-left text-sm"
            >
              <FolderIcon className="text-muted h-4 w-4 shrink-0" />
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  })();

  const errorNote =
    error === undefined ? null : <p className="text-accent mt-4 text-sm">{error}</p>;

  return (
    <div className="bg-background/90 fixed inset-0 z-10 flex items-start justify-center p-10">
      <div className="border-border bg-surface w-full max-w-2xl border p-8">
        <h2 className="font-serif text-2xl">{title}</h2>
        <p className="text-muted mt-2 truncate font-mono text-xs">{current ?? "Choose a start"}</p>

        <div className="mt-6">{current === undefined ? rootList : entryList}</div>
        {errorNote}

        <div className="mt-8 flex items-center gap-4">
          <Button
            tone={BUTTON_TONE.PRIMARY}
            disabled={current === undefined}
            onClick={() => {
              onChoose(current);
            }}
          >
            Use this folder
          </Button>
          <Button disabled={current === undefined || isAtRoot} onClick={goUp}>
            Up
          </Button>
          <Button
            tone={BUTTON_TONE.QUIET}
            onClick={() => {
              onChoose(undefined);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
