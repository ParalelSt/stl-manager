import { useState } from "react";
import type { ReviewGroup } from "../hooks/useReview.js";
import { plural } from "../text.js";
import { Button, BUTTON_TONE } from "./Button.js";
import { ChevronIcon } from "./icons/ChevronIcon.js";
import { FileIcon } from "./icons/FileIcon.js";

interface Props {
  group: ReviewGroup;
  isNameValid: (name: string) => boolean;
  onRename: (groupId: string, name: string) => void;
  onChangePurpose: (groupId: string, purpose: string | undefined) => void;
  onToggleExcluded: (groupId: string, isExcluded: boolean) => void;
  onSplit: (groupId: string) => void;
}

export function GroupRow({
  group,
  isNameValid,
  onRename,
  onChangePurpose,
  onToggleExcluded,
  onSplit,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftName, setDraftName] = useState(group.displayName);
  const [draftPurpose, setDraftPurpose] = useState(group.purpose ?? "");

  const commitName = () => {
    if (draftName === group.displayName) {
      return;
    }
    if (!isNameValid(draftName)) {
      setDraftName(group.displayName);
      return;
    }
    onRename(group.id, draftName);
  };

  const commitPurpose = () => {
    const trimmed = draftPurpose.trim();
    if (trimmed === (group.purpose ?? "")) {
      return;
    }
    if (trimmed !== "" && !isNameValid(trimmed)) {
      setDraftPurpose(group.purpose ?? "");
      return;
    }
    onChangePurpose(group.id, trimmed === "" ? undefined : trimmed);
  };

  const canSplit = new Set(group.kept.map((file) => file.sourceDir)).size > 1;
  const hasDivergent = group.kept.length > 1;

  const rowTone = group.isExcluded ? "opacity-45" : "";

  const duplicateNote =
    group.duplicates.length === 0 ? null : (
      <span className="text-muted text-xs">
        {plural(group.duplicates.length, "identical copy", "identical copies")} quarantined
      </span>
    );

  const divergentNote = !hasDivergent ? null : (
    <span className="text-accent text-xs">
      {plural(group.kept.length, "file")} share this name but differ, so all are kept
    </span>
  );

  const files = !isOpen ? null : (
    <div className="border-border col-span-12 mt-4 border-t pt-4">
      <dl className="grid grid-cols-12 gap-x-6 gap-y-2 text-xs">
        <dt className="text-muted col-span-3">Moves into</dt>
        <dd className="col-span-9 font-mono break-all">{group.destinationFolder}</dd>
      </dl>
      <ul className="mt-4 space-y-1.5">
        {[...group.kept, ...group.companions].map((file) => (
          <li key={file.path} className="text-muted flex items-center gap-2 font-mono text-xs">
            <FileIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{file.path}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-4">
        <Button
          tone={BUTTON_TONE.QUIET}
          disabled={!canSplit}
          onClick={() => {
            onSplit(group.id);
          }}
        >
          {canSplit ? "Split by source folder" : "Nothing to split"}
        </Button>
        <Button
          tone={BUTTON_TONE.QUIET}
          onClick={() => {
            onToggleExcluded(group.id, !group.isExcluded);
          }}
        >
          {group.isExcluded ? "Include again" : "Leave these files alone"}
        </Button>
      </div>
    </div>
  );

  return (
    <li className={`border-border grid grid-cols-12 items-start gap-x-6 border-b py-5 ${rowTone}`}>
      <div className="col-span-12 flex items-start gap-3 md:col-span-5">
        <button
          type="button"
          aria-label={isOpen ? "Hide files" : "Show files"}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className="text-muted hover:text-text mt-1 shrink-0 transition-transform"
        >
          <ChevronIcon className={`h-4 w-4 ${isOpen ? "rotate-90" : ""}`} />
        </button>
        <div className="min-w-0 flex-1">
          <input
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
            }}
            onBlur={commitName}
            aria-label="Group name"
            className="border-border focus:border-accent w-full border-b bg-transparent pb-1 text-base focus:outline-none"
          />
          <div className="mt-1.5 flex flex-wrap gap-x-4">
            {duplicateNote}
            {divergentNote}
          </div>
        </div>
      </div>

      <div className="col-span-6 mt-3 md:col-span-4 md:mt-0">
        <input
          value={draftPurpose}
          placeholder="No parent folder"
          onChange={(event) => {
            setDraftPurpose(event.target.value);
          }}
          onBlur={commitPurpose}
          aria-label="Parent folder"
          className="border-border focus:border-accent placeholder:text-muted w-full border-b bg-transparent pb-1 text-sm focus:outline-none"
        />
      </div>

      <div className="text-muted col-span-6 mt-3 text-right text-sm tabular-nums md:col-span-3 md:mt-0">
        {plural(group.fileCount, "file")}
      </div>

      {files}
    </li>
  );
}
