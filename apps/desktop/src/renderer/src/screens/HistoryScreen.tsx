import { Button, BUTTON_TONE } from "../components/Button.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useHistory } from "../hooks/useHistory.js";
import { plural } from "../text.js";

function formatWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function HistoryScreen() {
  const { runs, error, pendingUndoId, isWorking, askToUndo, cancelUndo, confirmUndo, startOver } =
    useHistory();

  const errorNote =
    error === undefined ? null : (
      <p className="text-accent mt-6 flex items-start gap-2 text-sm">
        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );

  const list =
    runs.length === 0 ? (
      <p className="text-muted py-16 text-sm">No runs recorded in this library yet.</p>
    ) : (
      <ul className="border-border border-t">
        {runs.map((run) => {
          const isPending = run.runId === pendingUndoId;

          const actions = isPending ? (
            <div className="flex items-center gap-4">
              <span className="text-muted text-sm">Put every file back?</span>
              <Button
                tone={BUTTON_TONE.PRIMARY}
                disabled={isWorking}
                onClick={() => void confirmUndo()}
              >
                {isWorking ? "Working" : "Yes, undo"}
              </Button>
              <Button tone={BUTTON_TONE.QUIET} onClick={cancelUndo}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => {
                askToUndo(run.runId);
              }}
            >
              Undo this run
            </Button>
          );

          const failedNote =
            run.failed === 0 ? null : (
              <span className="text-accent"> · {run.failed} failed</span>
            );

          return (
            <li
              key={run.runId}
              className="border-border flex flex-wrap items-center justify-between gap-6 border-b py-5"
            >
              <div>
                <p className="text-base">{formatWhen(run.at)}</p>
                <p className="text-muted mt-1 text-sm tabular-nums">
                  {plural(run.moved, "file")} moved
                  {failedNote}
                </p>
              </div>
              {actions}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="mx-auto max-w-5xl px-10 pt-16 pb-24">
      <header className="grid grid-cols-12 gap-x-8">
        <div className="col-span-12 md:col-span-7">
          <h1 className="font-serif text-5xl leading-tight">History</h1>
          <p className="text-muted mt-4 max-w-prose">
            Every run is recorded as it happens, so even a run interrupted part way through can be
            reversed. Undo never overwrites: a file whose old location is occupied is reported
            rather than replaced.
          </p>
          {errorNote}
        </div>
      </header>

      <section className="mt-14">{list}</section>

      <footer className="mt-14">
        <Button onClick={startOver}>Sort another folder</Button>
      </footer>
    </div>
  );
}
