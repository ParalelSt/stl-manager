import { SORTING_PROFILE, SORTING_PROFILES, type SortingProfile } from "@stl-manager/core";

interface Props {
  chosen: SortingProfile;
  onChoose: (profile: SortingProfile) => void;
}

/**
 * How one layout is described and shown.
 *
 * Every example is the same three files sorted four ways, because the only
 * useful thing to say about a layout is what it does differently to the others.
 * The trees are not decoration: each one is asserted against the engine in
 * sortingProfile.test.ts, so a change in behaviour breaks a test rather than
 * quietly making this screen lie.
 */
export interface Layout {
  name: string;
  summary: string;
  tree: string[];
}

/**
 * The three files every example sorts, as paths under a scanned folder.
 *
 * Exported so the test can put exactly these through the engine and check the
 * trees below are what actually comes out.
 */
export const EXAMPLE_FILES = [
  "/scan/Camshaft/cam_v1_mild.stl",
  "/scan/Camshaft/cam_v1_high.stl",
  "/scan/Gears/gear.obj",
];

export const LAYOUTS: Record<SortingProfile, Layout> = {
  [SORTING_PROFILE.FAMILY]: {
    name: "By family",
    summary: "Models whose names start alike share a folder. Variants of one thing stay together.",
    tree: ["cam_v1/", "  cam_v1_high.stl", "  cam_v1_mild.stl", "gear/", "  gear.obj"],
  },
  [SORTING_PROFILE.NAME]: {
    name: "By name",
    summary: "Every distinct name gets its own folder. Nothing is merged and nothing is guessed.",
    tree: [
      "cam_v1_high/",
      "  cam_v1_high.stl",
      "cam_v1_mild/",
      "  cam_v1_mild.stl",
      "gear/",
      "  gear.obj",
    ],
  },
  [SORTING_PROFILE.SOURCE]: {
    name: "By the folder they came from",
    summary: "Families kept under their original folder, for a collection already sorted well.",
    tree: [
      "Camshaft/",
      "  cam_v1/",
      "    cam_v1_high.stl",
      "    cam_v1_mild.stl",
      "Gears/",
      "  gear/",
      "    gear.obj",
    ],
  },
  [SORTING_PROFILE.TYPE]: {
    name: "By file type",
    summary: "Meshes, projects and slicer files each get a top folder of their own.",
    tree: [
      "OBJ/",
      "  gear/",
      "    gear.obj",
      "STL/",
      "  cam_v1/",
      "    cam_v1_high.stl",
      "    cam_v1_mild.stl",
    ],
  },
};

/**
 * Names a layout for a screen that only needs to say which one was used.
 *
 * @param profile - The layout a plan was built with
 * @returns Its name, lowercased to sit inside a sentence
 */
export function layoutName(profile: SortingProfile): string {
  return LAYOUTS[profile].name.toLowerCase();
}

/**
 * Chooses the shape of the library before anything is scanned.
 *
 * Presented up front rather than in review because it decides the whole tree,
 * not the fate of one file: changing it later would mean planning again from
 * the beginning.
 */
export function LayoutChooser({ chosen, onChoose }: Props) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {SORTING_PROFILES.map((profile) => {
        const layout = LAYOUTS[profile];
        const isChosen = profile === chosen;
        return (
          <label
            key={profile}
            className={`flex cursor-pointer flex-col gap-3 border p-4 transition-colors ${
              isChosen ? "border-text bg-surface" : "border-border hover:border-muted"
            }`}
          >
            <span className="flex items-baseline gap-3">
              <input
                type="radio"
                name="layout"
                value={profile}
                checked={isChosen}
                onChange={() => {
                  onChoose(profile);
                }}
              />
              <span className="font-serif text-lg">{layout.name}</span>
            </span>
            <span className="text-muted text-sm">{layout.summary}</span>
            <pre className="text-muted overflow-x-auto font-mono text-xs leading-relaxed">
              {layout.tree.join("\n")}
            </pre>
          </label>
        );
      })}
    </div>
  );
}
