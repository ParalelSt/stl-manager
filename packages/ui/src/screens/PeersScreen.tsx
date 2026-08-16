import type { TreeFolder } from "@stl-manager/core";
import { useState } from "react";
import { Button, BUTTON_TONE } from "../components/Button.js";
import { LibraryTree } from "../components/LibraryTree.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { usePeerLibrary, usePeers } from "../hooks/usePeers.js";
import { plural } from "../text.js";

export function PeersScreen() {
  const { peers, error, isWorking, pair, forget, back } = usePeers();

  const [baseUrl, setBaseUrl] = useState("");
  const [shareToken, setShareToken] = useState("");
  const [libraryRoot, setLibraryRoot] = useState("");
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const remote = usePeerLibrary(selected);

  const submit = async (): Promise<void> => {
    const ok = await pair(baseUrl, shareToken, libraryRoot, label);
    if (ok) {
      setBaseUrl("");
      setShareToken("");
      setLibraryRoot("");
      setLabel("");
    }
  };

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-4 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const peerList =
    peers.length === 0 ? (
      <p className="text-muted py-8 text-sm">No machines paired yet.</p>
    ) : (
      <ul className="border-border border-t">
        {peers.map((peer) => {
          const isOpen = peer.id === selected;
          return (
            <li key={peer.id} className="border-border border-b py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base">{peer.label}</p>
                  <p className="text-muted mt-1 truncate font-mono text-xs">
                    {peer.baseUrl} · {peer.libraryRoot}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      setSelected(isOpen ? undefined : peer.id);
                    }}
                  >
                    {isOpen ? "Hide" : "Browse"}
                  </Button>
                  <Button
                    tone={BUTTON_TONE.QUIET}
                    onClick={() => {
                      void forget(peer.id);
                    }}
                  >
                    Forget
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );

  const pullNote =
    remote.outcome === undefined ? null : (
      <p className="text-muted mt-4 text-sm">
        {plural(remote.outcome.fetched, "file")} arrived
        {remote.outcome.skipped > 0 ? `, ${remote.outcome.skipped} already had` : ""}
        {remote.outcome.failed.length > 0
          ? `, ${plural(remote.outcome.failed.length, "file")} could not be fetched`
          : ""}
        . Scan {remote.stagingDir} to sort them into your library.
      </p>
    );

  const remoteTree = (() => {
    if (selected === undefined) {
      return null;
    }
    if (remote.root === undefined) {
      return (
        <p className="text-muted py-8 text-sm">
          {remote.isLoading ? "Reading that machine." : (remote.error ?? "Nothing to show.")}
        </p>
      );
    }
    const catalogue = remote.root;
    return (
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="font-serif text-2xl">What they have</h2>
          <Button
            tone={BUTTON_TONE.PRIMARY}
            disabled={remote.isLoading || remote.stagingDir === undefined}
            onClick={() => {
              void remote.pull(collectPaths(catalogue));
            }}
          >
            {remote.isLoading ? "Working" : "Pull everything"}
          </Button>
        </div>
        <p className="text-muted mt-2 max-w-prose text-sm">
          Files arrive in a staging folder and are sorted by your own rules when you scan it.
          Nothing on that machine is changed.
        </p>
        {pullNote}
        <div className="mt-6">
          <LibraryTree root={catalogue} isEditable={false} onRename={noop} onMoveModel={noop} />
        </div>
      </section>
    );
  })();

  return (
    <div className="mx-auto max-w-5xl px-10 pt-16 pb-24">
      <header className="grid grid-cols-12 gap-x-8">
        <div className="col-span-12 md:col-span-8">
          <h1 className="font-serif text-5xl leading-tight">Other machines</h1>
          <p className="text-muted mt-4 max-w-prose">
            Pair with another machine running STL Manager to see what it holds and copy models
            across. It can never write anything here, and you can never change anything there.
          </p>
          {errorNote}
        </div>
      </header>

      <section className="mt-12">
        <h2 className="font-serif text-2xl">Paired</h2>
        <div className="mt-4">{peerList}</div>
      </section>

      <section className="mt-12 max-w-2xl">
        <h2 className="font-serif text-2xl">Add a machine</h2>
        <p className="text-muted mt-2 text-sm">
          The other machine prints a share token in its log when it starts. That token only lets
          this one read.
        </p>
        <div className="mt-6 space-y-5">
          <Field label="Address" value={baseUrl} onChange={setBaseUrl} placeholder="http://192.168.1.42:8080" />
          <Field label="Share token" value={shareToken} onChange={setShareToken} placeholder="" />
          <Field label="Their library" value={libraryRoot} onChange={setLibraryRoot} placeholder="/data/library" />
          <Field label="Name (optional)" value={label} onChange={setLabel} placeholder="linux-pc" />
        </div>
        <div className="mt-8">
          <Button tone={BUTTON_TONE.PRIMARY} disabled={isWorking} onClick={() => void submit()}>
            {isWorking ? "Checking" : "Pair"}
          </Button>
        </div>
      </section>

      {remoteTree}

      <footer className="mt-14">
        <Button onClick={back}>Back</Button>
      </footer>
    </div>
  );
}

function noop(): void {
  // The remote tree is read-only: nothing here may change another machine.
}

/** Every file path in a catalogue, which is what a pull asks for. */
function collectPaths(node: TreeFolder): string[] {
  const paths: string[] = [];
  const walk = (entry: { kind: string; path: string; children?: unknown[] }): void => {
    if (entry.kind === "file") {
      paths.push(entry.path);
      return;
    }
    for (const child of (entry.children ?? []) as typeof entry[]) {
      walk(child);
    }
  };
  walk(node);
  return paths;
}

interface FieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

function Field({ label, value, placeholder, onChange }: FieldProps) {
  return (
    <label className="block">
      <span className="text-muted text-xs tracking-wide uppercase">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="border-border focus:border-accent placeholder:text-muted mt-2 w-full border-b bg-transparent pb-2 font-mono text-sm focus:outline-none"
      />
    </label>
  );
}
