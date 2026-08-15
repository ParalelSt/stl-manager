import { Button, BUTTON_TONE } from "../components/Button.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useApply } from "../hooks/useApply.js";
import { plural, wasWere } from "../text.js";

export function ApplyScreen() {
  const {
    moves,
    progress,
    applied,
    error,
    isConfirmed,
    isApplying,
    confirm,
    start,
    back,
    viewHistory,
  } = useApply();

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-6 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const body = (() => {
    if (applied !== undefined) {
      const failedNote =
        applied.failed === 0 ? null : (
          <p className="text-accent mt-4 text-sm">
            {plural(applied.failed, "file")} could not be moved and {wasWere(applied.failed)} left
            in place.
          </p>
        );
      const skippedNote =
        applied.skipped === 0 ? null : (
          <p className="text-muted mt-2 text-sm">
            {plural(applied.skipped, "file")} changed since the scan and {wasWere(applied.skipped)}{" "}
            skipped.
          </p>
        );

      return (
        <div className="mt-10">
          <p className="font-serif text-6xl tabular-nums">{applied.moved.toLocaleString()}</p>
          <p className="text-muted mt-2 text-sm">files moved into the library</p>
          {failedNote}
          {skippedNote}
          <p className="text-muted mt-8 max-w-prose text-sm">
            Every move was recorded. If this is not what you wanted, the whole run can be reversed
            from the history screen.
          </p>
          <div className="mt-8">
            <Button tone={BUTTON_TONE.PRIMARY} onClick={viewHistory}>
              View history
            </Button>
          </div>
        </div>
      );
    }

    if (isApplying) {
      const done = progress?.done ?? 0;
      const total = progress?.total ?? moves.length;
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);

      return (
        <div className="mt-10">
          <p className="font-serif text-6xl tabular-nums">{percent}%</p>
          <p className="text-muted mt-2 text-sm">
            {done.toLocaleString()} of {total.toLocaleString()} files
          </p>
          <div className="border-border mt-8 h-1 w-full max-w-md border">
            <div className="bg-accent h-full" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-muted mt-8 truncate font-mono text-xs">
            {progress?.currentPath ?? ""}
          </p>
        </div>
      );
    }

    if (!isConfirmed) {
      return (
        <div className="mt-10">
          <div className="border-border bg-surface max-w-prose border p-6">
            <p className="text-sm">
              This will move {plural(moves.length, "file")} on your disk. Original locations
              are recorded, so the whole run can be reversed afterwards.
            </p>
          </div>
          <div className="mt-8 flex gap-4">
            <Button tone={BUTTON_TONE.PRIMARY} onClick={confirm}>
              I understand, continue
            </Button>
            <Button onClick={back}>Back to review</Button>
          </div>
          {errorNote}
        </div>
      );
    }

    return (
      <div className="mt-10">
        <p className="max-w-prose text-sm">Ready. This is the last point at which nothing has moved.</p>
        <div className="mt-8 flex gap-4">
          <Button tone={BUTTON_TONE.PRIMARY} onClick={() => void start()}>
            Move {plural(moves.length, "file")}
          </Button>
          <Button onClick={back}>Back to review</Button>
        </div>
        {errorNote}
      </div>
    );
  })();

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-12 gap-x-8 px-10 pt-24">
      <header className="col-span-12 md:col-span-8">
        <p className="text-muted text-xs tracking-[0.2em] uppercase">Step four</p>
        <h1 className="font-serif mt-3 text-5xl leading-tight">
          {applied === undefined ? "Move the files" : "Done"}
        </h1>
        {body}
      </header>
    </div>
  );
}
