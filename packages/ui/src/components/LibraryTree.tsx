import { toNameKey, type TreeFile, type TreeFolder, type TreeNode } from "@stl-manager/core";
import { useMemo, useState } from "react";
import { FileRow, FolderRow } from "./TreeRow.js";

interface Props {
  root: TreeFolder;
  /** Editing is only possible before a plan is applied. */
  isEditable: boolean;
  onRename: (groupId: string, name: string) => void;
  onMoveModel: (nameKey: string, targetGroupId: string) => void;
}

/** How many levels are expanded when the tree first appears. */
const INITIALLY_OPEN_DEPTH = 2;

function collectOpenPaths(folder: TreeFolder, depth: number, into: Set<string>): void {
  if (depth > INITIALLY_OPEN_DEPTH) {
    return;
  }
  into.add(folder.path);
  for (const child of folder.children) {
    if (child.kind === "folder") {
      collectOpenPaths(child, depth + 1, into);
    }
  }
}

function nameKeyOf(file: TreeFile): string {
  const dot = file.name.lastIndexOf(".");
  return toNameKey(dot > 0 ? file.name.slice(0, dot) : file.name);
}

/**
 * The library as a navigable tree.
 *
 * Before a plan is applied, folders belonging to a family can be renamed in
 * place and a model can be dragged from one family into another. Dragging
 * moves the whole model rather than the single file, because a model is often
 * a mesh, a slicer file and a preview together.
 */
export function LibraryTree({ root, isEditable, onRename, onMoveModel }: Props) {
  const initiallyOpen = useMemo(() => {
    const paths = new Set<string>();
    collectOpenPaths(root, 0, paths);
    return paths;
  }, [root]);

  const [openPaths, setOpenPaths] = useState(initiallyOpen);
  const [draggingNameKey, setDraggingNameKey] = useState<string | undefined>(undefined);
  const [dropTargetPath, setDropTargetPath] = useState<string | undefined>(undefined);

  const toggle = (path: string): void => {
    setOpenPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const dropOnto = (groupId: string): void => {
    if (draggingNameKey !== undefined) {
      onMoveModel(draggingNameKey, groupId);
    }
    setDraggingNameKey(undefined);
    setDropTargetPath(undefined);
  };

  const renderNode = (node: TreeNode, depth: number): React.JSX.Element[] => {
    if (node.kind === "file") {
      return [
        <FileRow
          key={node.path}
          file={node}
          depth={depth}
          isEditable={isEditable}
          nameKeyOf={nameKeyOf}
          onDragModel={setDraggingNameKey}
        />,
      ];
    }

    const isOpen = openPaths.has(node.path);
    const rows = [
      <FolderRow
        key={node.path}
        folder={node}
        depth={depth}
        isOpen={isOpen}
        isEditable={isEditable}
        isDropTarget={dropTargetPath === node.path && draggingNameKey !== undefined}
        onToggle={toggle}
        onRename={onRename}
        onDropModel={dropOnto}
        onDragOverFolder={setDropTargetPath}
      />,
    ];

    if (!isOpen) {
      return rows;
    }
    for (const child of node.children) {
      rows.push(...renderNode(child, depth + 1));
    }
    return rows;
  };

  const emptyNote =
    root.children.length > 0 ? null : (
      <p className="text-muted py-16 text-center text-sm">
        Nothing would be moved into the library.
      </p>
    );

  return (
    <div className="border-border border-y">
      {renderNode(root, 0)}
      {emptyNote}
    </div>
  );
}
