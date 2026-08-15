import { Button, BUTTON_TONE } from "../components/Button.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useScan } from "../hooks/useScan.js";

export function ScanScreen() {
  const { isScanning, progress, error, cancel, retry } = useScan();

  const count = progress?.done ?? 0;
  const currentPath = progress?.currentPath ?? "";

  const body = (() => {
    if (error !== undefined) {
      return (
        <div className="mt-10">
          <p className="text-accent flex items-start gap-2">
            <WarningIcon className="mt-1 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
          <div className="mt-8 flex gap-4">
            <Button tone={BUTTON_TONE.PRIMARY} onClick={() => void retry()}>
              Try again
            </Button>
            <Button onClick={cancel}>Back to setup</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-10">
        <p className="font-serif text-6xl tabular-nums">{count.toLocaleString()}</p>
        <p className="text-muted mt-2 text-sm">
          {isScanning ? "files found so far" : "files found"}
        </p>
        <p className="text-muted mt-10 truncate font-mono text-xs">{currentPath}</p>
        <div className="mt-10">
          <Button onClick={cancel}>Cancel</Button>
        </div>
      </div>
    );
  })();

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-12 gap-x-8 px-10 pt-24">
      <header className="col-span-12 md:col-span-7">
        <p className="text-muted text-xs tracking-[0.2em] uppercase">Step two</p>
        <h1 className="font-serif mt-3 text-5xl leading-tight">Looking for models</h1>
        <p className="text-muted mt-4 max-w-prose">
          Reading only. Nothing is being moved, renamed, or deleted while this runs.
        </p>
        {body}
      </header>
    </div>
  );
}
