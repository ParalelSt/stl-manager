import { Button, BUTTON_TONE } from "../components/Button.js";
import { DirectoryPicker } from "../components/DirectoryPicker.js";
import { FolderIcon } from "../components/icons/FolderIcon.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useSetup } from "../hooks/useSetup.js";

export function SetupScreen() {
  const {
    libraryRoot,
    scanRoots,
    error,
    isReady,
    chooseLibraryRoot,
    addScanRoot,
    removeScanRoot,
    start,
    isPickerOpen,
    resolvePicker,
  } = useSetup();

  const libraryValue =
    libraryRoot === undefined ? (
      <span className="text-muted">No folder chosen</span>
    ) : (
      <span className="font-mono text-sm">{libraryRoot}</span>
    );

  const rootList =
    scanRoots.length === 0 ? (
      <p className="text-muted text-sm">
        Nothing chosen yet. Add the folders your models are scattered across.
      </p>
    ) : (
      <ul className="divide-border divide-y border-border border-y">
        {scanRoots.map((root) => (
          <li key={root} className="flex items-center justify-between gap-6 py-3">
            <span className="flex min-w-0 items-center gap-3">
              <FolderIcon className="text-muted h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-sm">{root}</span>
            </span>
            <Button
              tone={BUTTON_TONE.QUIET}
              onClick={() => {
                removeScanRoot(root);
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    );

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-6 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const picker = !isPickerOpen ? null : (
    <DirectoryPicker title="Choose a folder" onChoose={resolvePicker} />
  );

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-12 gap-x-8 px-10 pt-16 pb-24">
      {picker}
      <header className="col-span-12 mb-16 md:col-span-7">
        <p className="text-muted text-xs tracking-[0.2em] uppercase">Step one</p>
        <h1 className="font-serif mt-3 text-5xl leading-tight">Choose where things go</h1>
        <p className="text-muted mt-4 max-w-prose">
          Nothing is moved until you have seen exactly what would happen. This step only
          decides where to look and where the library will live.
        </p>
      </header>

      <section className="col-span-12 mb-14 md:col-span-8 md:col-start-1">
        <h2 className="font-serif text-2xl">The library</h2>
        <p className="text-muted mt-2 max-w-prose text-sm">
          Every model found is moved here, sorted into folders by name and purpose.
        </p>
        <div className="border-border bg-surface mt-6 flex items-center justify-between gap-6 border p-4">
          {libraryValue}
          <Button onClick={() => void chooseLibraryRoot()}>
            {libraryRoot === undefined ? "Choose folder" : "Change"}
          </Button>
        </div>
      </section>

      <section className="col-span-12 md:col-span-10">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="font-serif text-2xl">Folders to search</h2>
          <Button onClick={() => void addScanRoot()}>Add folder</Button>
        </div>
        <p className="text-muted mt-2 max-w-prose text-sm">
          System folders, application bundles and the library itself are always skipped.
        </p>
        <div className="mt-6">{rootList}</div>
        {errorNote}
      </section>

      <footer className="col-span-12 mt-16 flex items-center gap-6">
        <Button tone={BUTTON_TONE.PRIMARY} disabled={!isReady} onClick={start}>
          Scan for models
        </Button>
        <span className="text-muted text-sm">
          {isReady ? "Nothing will be moved yet." : "Choose a library and at least one folder."}
        </span>
      </footer>
    </div>
  );
}
