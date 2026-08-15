import { Button, BUTTON_TONE } from "../components/Button.js";
import { LibraryTree } from "../components/LibraryTree.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useLibrary } from "../hooks/useLibrary.js";
import { formatBytes, plural } from "../text.js";

export function LibraryScreen() {
  const { libraryRoot, root, error, isLoading, refresh, reveal, back } = useLibrary();

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-6 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const body = (() => {
    if (root === undefined) {
      return (
        <p className="text-muted py-16 text-sm">
          {isLoading ? "Reading the library." : "Nothing to show yet."}
        </p>
      );
    }
    if (root.fileCount === 0) {
      return <p className="text-muted py-16 text-sm">The library is empty.</p>;
    }
    return (
      <LibraryTree
        root={root}
        isEditable={false}
        onRename={() => {}}
        onMoveModel={() => {}}
      />
    );
  })();

  const summary =
    root === undefined ? null : (
      <p className="text-muted mt-4 text-sm">
        {plural(root.fileCount, "file")} · {formatBytes(root.totalBytes)}
      </p>
    );

  return (
    <div className="mx-auto max-w-6xl px-10 pt-16 pb-24">
      <header className="grid grid-cols-12 gap-x-8">
        <div className="col-span-12 md:col-span-8">
          <h1 className="font-serif text-5xl leading-tight">Your library</h1>
          <p className="text-muted mt-4 max-w-prose font-mono text-xs">{libraryRoot}</p>
          {summary}
          {errorNote}
        </div>
      </header>

      <section className="mt-12">{body}</section>

      <footer className="mt-12 flex gap-4">
        <Button onClick={back}>Back</Button>
        <Button onClick={() => void refresh()}>Refresh</Button>
        <Button
          tone={BUTTON_TONE.QUIET}
          disabled={libraryRoot === undefined}
          onClick={() => {
            if (libraryRoot !== undefined) {
              reveal(libraryRoot);
            }
          }}
        >
          Show in Finder
        </Button>
      </footer>
    </div>
  );
}
