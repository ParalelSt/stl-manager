import { useMemo, useState } from "react";
import { Button, BUTTON_TONE } from "../components/Button.js";
import { GroupRow } from "../components/GroupRow.js";
import { WarningIcon } from "../components/icons/WarningIcon.js";
import { useReview } from "../hooks/useReview.js";
import { formatBytes, plural, wasWere } from "../text.js";

export function ReviewScreen() {
  const {
    plan,
    groups,
    summary,
    isNameValid,
    rename,
    changePurpose,
    toggleExcluded,
    split,
    back,
    proceed,
  } = useReview();

  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") {
      return groups;
    }
    return groups.filter(
      (group) =>
        group.displayName.toLowerCase().includes(needle) ||
        (group.purpose ?? "").toLowerCase().includes(needle),
    );
  }, [filter, groups]);

  if (plan === undefined) {
    return (
      <div className="mx-auto max-w-5xl px-10 pt-24">
        <p className="text-muted">There is no plan to review. Start a scan first.</p>
        <div className="mt-6">
          <Button onClick={back}>Back to setup</Button>
        </div>
      </div>
    );
  }

  const problems =
    plan.problems.length === 0 ? null : (
      <p className="text-muted mt-4 flex items-start gap-2 text-sm">
        <WarningIcon className="text-accent mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {plural(plan.problems.length, "folder")} could not be read and{" "}
          {wasWere(plan.problems.length)} skipped.
        </span>
      </p>
    );

  const untouched =
    plan.untouched.length === 0 ? null : (
      <p className="text-muted mt-2 text-sm">
        {plural(plan.untouched.length, "loose file")} had no model to travel with and{" "}
        {plan.untouched.length === 1 ? "will be left where it is" : "will be left where they are"}.
      </p>
    );

  const emptyNote =
    visible.length > 0 ? null : (
      <p className="text-muted py-16 text-center text-sm">Nothing matches that filter.</p>
    );

  return (
    <div className="mx-auto max-w-6xl px-10 pt-16 pb-32">
      <header className="grid grid-cols-12 gap-x-8">
        <div className="col-span-12 md:col-span-7">
          <p className="text-muted text-xs tracking-[0.2em] uppercase">Step three</p>
          <h1 className="font-serif mt-3 text-5xl leading-tight">Check the plan</h1>
          <p className="text-muted mt-4 max-w-prose">
            Rename a group, give it a parent folder, or leave it out. Still nothing has moved.
          </p>
          {problems}
          {untouched}
        </div>

        <dl className="border-border col-span-12 mt-10 grid grid-cols-2 gap-y-6 border-t pt-6 md:col-span-4 md:col-start-9 md:mt-0 md:border-t-0 md:pt-0">
          <div>
            <dt className="text-muted text-xs tracking-wide uppercase">Groups</dt>
            <dd className="font-serif mt-1 text-3xl tabular-nums">{summary.groupCount}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs tracking-wide uppercase">Files to move</dt>
            <dd className="font-serif mt-1 text-3xl tabular-nums">{summary.moveCount}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs tracking-wide uppercase">Duplicates</dt>
            <dd className="font-serif mt-1 text-3xl tabular-nums">{summary.duplicateCount}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs tracking-wide uppercase">Total size</dt>
            <dd className="font-serif mt-1 text-3xl tabular-nums">
              {formatBytes(summary.totalBytes)}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-16">
        <input
          value={filter}
          placeholder="Filter groups"
          aria-label="Filter groups"
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          className="border-border focus:border-accent placeholder:text-muted w-72 border-b bg-transparent pb-2 text-sm focus:outline-none"
        />

        <div className="text-muted border-border mt-10 hidden grid-cols-12 gap-x-6 border-b pb-3 text-xs tracking-wide uppercase md:grid">
          <span className="col-span-5 pl-7">Group</span>
          <span className="col-span-4">Parent folder</span>
          <span className="col-span-3 text-right">Files</span>
        </div>

        <ul>
          {visible.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              isNameValid={isNameValid}
              onRename={rename}
              onChangePurpose={changePurpose}
              onToggleExcluded={toggleExcluded}
              onSplit={split}
            />
          ))}
        </ul>
        {emptyNote}
      </section>

      <footer className="border-border bg-background fixed inset-x-0 bottom-0 border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-10 py-4">
          <span className="text-muted text-sm">
            {plural(summary.moveCount, "file")} will move
            {summary.excludedCount > 0
              ? `, ${plural(summary.excludedCount, "group")} left alone`
              : ""}
          </span>
          <div className="flex gap-4">
            <Button onClick={back}>Back</Button>
            <Button
              tone={BUTTON_TONE.PRIMARY}
              disabled={summary.moveCount === 0}
              onClick={proceed}
            >
              Continue
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
