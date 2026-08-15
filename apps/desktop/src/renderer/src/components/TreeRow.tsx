import type { TreeFile, TreeFolder } from "@stl-manager/core";
import { formatBytes, plural } from "../text.js";
import { ChevronIcon } from "./icons/ChevronIcon.js";
import { FileIcon } from "./icons/FileIcon.js";
import { FolderIcon } from "./icons/FolderIcon.js";

/** How deeply a row is indented per level of nesting. */
const INDENT_PX = 20;

interface FolderProps {
  folder: TreeFolder;
  depth: number;
  isOpen: boolean;
  isEditable: boolean;
  isDropTarget: boolean;
  onToggle: (path: string) => void;
  onRename: (groupId: string, name: string) => void;
  onDropModel: (groupId: string) => void;
  onDragOverFolder: (path: string | undefined) => void;
}

export function FolderRow({
  folder,
  depth,
  isOpen,
  isEditable,
  isDropTarget,
  onToggle,
  onRename,
  onDropModel,
  onDragOverFolder,
}: FolderProps) {
  const canRename = isEditable && folder.groupId !== undefined;

  const name = canRename ? (
    <input
      defaultValue={folder.name}
      aria-label={`Folder name for ${folder.name}`}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onBlur={(event) => {
        const value = event.target.value;
        if (folder.groupId !== undefined && value !== folder.name) {
          onRename(folder.groupId, value);
        }
      }}
      className="focus:border-accent min-w-0 flex-1 border-b border-transparent bg-transparent text-sm focus:outline-none"
    />
  ) : (
    <span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span>
  );

  const canAccept = isEditable && folder.groupId !== undefined;
  const highlight = isDropTarget && canAccept ? "bg-surface outline outline-accent" : "";

  return (
    <div
      style={{ paddingLeft: depth * INDENT_PX }}
      className={`hover:bg-surface flex items-center gap-2 py-1.5 pr-2 ${highlight}`}
      onDragOver={(event) => {
        if (!canAccept) {
          return;
        }
        event.preventDefault();
        onDragOverFolder(folder.path);
      }}
      onDragLeave={() => {
        onDragOverFolder(undefined);
      }}
      onDrop={(event) => {
        if (!canAccept || folder.groupId === undefined) {
          return;
        }
        event.preventDefault();
        onDropModel(folder.groupId);
      }}
    >
      <button
        type="button"
        aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
        onClick={() => {
          onToggle(folder.path);
        }}
        className="text-muted hover:text-text shrink-0"
      >
        <ChevronIcon className={`h-3.5 w-3.5 ${isOpen ? "rotate-90" : ""}`} />
      </button>
      <FolderIcon className="text-muted h-4 w-4 shrink-0" />
      {name}
      <span className="text-muted shrink-0 text-xs tabular-nums">
        {plural(folder.fileCount, "file")}
      </span>
      <span className="text-muted w-20 shrink-0 text-right text-xs tabular-nums">
        {formatBytes(folder.totalBytes)}
      </span>
    </div>
  );
}

interface FileProps {
  file: TreeFile;
  depth: number;
  isEditable: boolean;
  nameKeyOf: (file: TreeFile) => string;
  onDragModel: (nameKey: string | undefined) => void;
}

const REASON_LABEL: Record<string, string> = {
  companion: "companion",
  duplicate: "duplicate",
};

export function FileRow({ file, depth, isEditable, nameKeyOf, onDragModel }: FileProps) {
  const note = REASON_LABEL[file.reason];
  const noteElement =
    note === undefined ? null : <span className="text-muted text-xs">{note}</span>;

  return (
    <div
      style={{ paddingLeft: depth * INDENT_PX + INDENT_PX }}
      draggable={isEditable}
      onDragStart={() => {
        onDragModel(nameKeyOf(file));
      }}
      onDragEnd={() => {
        onDragModel(undefined);
      }}
      className={`hover:bg-surface flex items-center gap-2 py-1 pr-2 ${isEditable ? "cursor-grab" : ""}`}
    >
      <FileIcon className="text-muted ml-3.5 h-3.5 w-3.5 shrink-0" />
      <span className="text-muted min-w-0 flex-1 truncate font-mono text-xs">{file.name}</span>
      {noteElement}
      <span className="text-muted w-20 shrink-0 text-right text-xs tabular-nums">
        {formatBytes(file.size)}
      </span>
    </div>
  );
}
