import { describe, expect, it } from "vitest";
import { groupIntoFamilies, toTokens, type FamilyCandidate } from "./families.js";
import { posixPath } from "./posixPath.js";

function candidate(stem: string, sourceDir = "/home/Downloads"): FamilyCandidate {
  return { nameKey: stem.toLowerCase(), stem, sourceDir };
}

function labelsOf(candidates: FamilyCandidate[]): string[] {
  return groupIntoFamilies(candidates, posixPath)
    .map((family) => family.label)
    .sort();
}

function familyFor(candidates: FamilyCandidate[], stem: string): string[] | undefined {
  return groupIntoFamilies(candidates, posixPath)
    .find((family) => family.nameKeys.includes(stem.toLowerCase()))
    ?.nameKeys.sort();
}

describe("toTokens", () => {
  it("splits on underscores, hyphens, dots and spaces", () => {
    expect(toTokens("vacuum_adapter-30p3.dual technic")).toEqual([
      "vacuum",
      "adapter",
      "30p3",
      "dual",
      "technic",
    ]);
  });

  it("lowercases", () => {
    expect(toTokens("Kit_Base")).toEqual(["kit", "base"]);
  });

  it("drops empty segments from repeated separators", () => {
    expect(toTokens("kit__base")).toEqual(["kit", "base"]);
  });

  it("returns nothing for a stem of only separators", () => {
    expect(toTokens("___")).toEqual([]);
  });
});

describe("groupIntoFamilies", () => {
  it("groups names sharing their first word", () => {
    const members = familyFor(
      [candidate("kit_base"), candidate("kit_lip"), candidate("tower")],
      "kit_base",
    );
    expect(members).toEqual(["kit_base", "kit_lip"]);
  });

  it("names a family after the words every member shares", () => {
    expect(
      labelsOf([candidate("kit_base"), candidate("kit_lip"), candidate("kit_straight")]),
    ).toEqual(["kit"]);
  });

  it("uses the longest shared run, not just the first word", () => {
    expect(
      labelsOf([
        candidate("v10_to_vacuum_33p3_snap_coupler_v11"),
        candidate("v10_to_vacuum_33p3_short_sealed_coupler_v13"),
      ]),
    ).toEqual(["v10_to_vacuum_33p3"]);
  });

  it("joins a whole family transitively", () => {
    // 30p3 and current share only "vacuum adapter", but both join that family.
    const members = familyFor(
      [
        candidate("vacuum_adapter_30p3_dual_technic_portside_v6"),
        candidate("vacuum_adapter_30p3_dual_technic_portside_v7"),
        candidate("vacuum_adapter_current_1cyl_v8"),
      ],
      "vacuum_adapter_current_1cyl_v8",
    );
    expect(members).toHaveLength(3);
    expect(labelsOf([
      candidate("vacuum_adapter_30p3_dual_technic_portside_v6"),
      candidate("vacuum_adapter_30p3_dual_technic_portside_v7"),
      candidate("vacuum_adapter_current_1cyl_v8"),
    ])).toEqual(["vacuum_adapter"]);
  });

  it("keeps unrelated names apart", () => {
    expect(labelsOf([candidate("kit_base"), candidate("tower"), candidate("dragon")])).toEqual([
      "dragon",
      "kit_base",
      "tower",
    ]);
  });

  it("leaves a name with no relatives on its own", () => {
    const families = groupIntoFamilies([candidate("svs_single_cyl_intake_v1")], posixPath);
    expect(families).toHaveLength(1);
    expect(families[0]?.nameKeys).toEqual(["svs_single_cyl_intake_v1"]);
    expect(families[0]?.label).toBe("svs_single_cyl_intake_v1");
  });

  it("groups by a shared numeric identifier", () => {
    expect(
      familyFor(
        [candidate("2853_fixed"), candidate("2853_hole_plus"), candidate("2854_fixed")],
        "2853_fixed",
      ),
    ).toEqual(["2853_fixed", "2853_hole_plus"]);
  });

  it("does not merge different numeric identifiers", () => {
    expect(
      labelsOf([candidate("2853_fixed"), candidate("2853_holes"), candidate("2854_fixed")]),
    ).toEqual(["2853", "2854_fixed"]);
  });
});

describe("numbered sets", () => {
  const numbered = [
    candidate("01_adapter"),
    candidate("02_pipe_short"),
    candidate("03_pipe_medium"),
    candidate("04_pipe_long"),
  ];

  it("groups a run of numbered files from one folder", () => {
    const families = groupIntoFamilies(numbered, posixPath);
    expect(families).toHaveLength(1);
    expect(families[0]?.nameKeys).toHaveLength(4);
  });

  it("marks the family so the interface can explain it", () => {
    expect(groupIntoFamilies(numbered, posixPath)[0]?.isNumberedSet).toBe(true);
  });

  it("names it after the folder the files came from", () => {
    const families = groupIntoFamilies(
      numbered.map((entry) => ({ ...entry, sourceDir: "/home/Vacuum Kit" })),
      posixPath,
    );
    expect(families[0]?.label).toBe("Vacuum Kit");
  });

  it("does not group a run shorter than three", () => {
    const families = groupIntoFamilies([candidate("01_adapter"), candidate("02_pipe")], posixPath);
    expect(families).toHaveLength(2);
  });

  it("does not group numbered files from different folders", () => {
    const families = groupIntoFamilies(
      [
        candidate("01_adapter", "/home/a"),
        candidate("02_pipe", "/home/b"),
        candidate("03_elbow", "/home/c"),
      ],
      posixPath,
    );
    expect(families).toHaveLength(3);
  });

  it("does not treat large identifiers as a sequence", () => {
    // 2853 and 2854 are identifiers, not positions in a run.
    const families = groupIntoFamilies(
      [candidate("2853_fixed"), candidate("2854_fixed"), candidate("2855_fixed")],
      posixPath,
    );
    expect(families.every((family) => !family.isNumberedSet)).toBe(true);
  });

  it("does not treat a broken run as a sequence", () => {
    const families = groupIntoFamilies(
      [candidate("01_adapter"), candidate("07_pipe"), candidate("42_elbow")],
      posixPath,
    );
    expect(families.every((family) => !family.isNumberedSet)).toBe(true);
  });

  it("keeps a numbered set separate from an unrelated family in the same folder", () => {
    const families = groupIntoFamilies(
      [...numbered, candidate("kit_base"), candidate("kit_lip")],
      posixPath,
    );
    expect(families.map((family) => family.label).sort()).toEqual(["Downloads", "kit"]);
  });
});

describe("family labels", () => {
  it("keeps the spelling the user gave the files", () => {
    expect(labelsOf([candidate("Kit_Base"), candidate("Kit_Lip")])).toEqual(["Kit"]);
  });

  it("keeps the separator style of the original name", () => {
    expect(labelsOf([candidate("Space-Marine-A"), candidate("Space-Marine-B")])).toEqual([
      "Space-Marine",
    ]);
  });

  it("keeps spaces in a name that used them", () => {
    expect(labelsOf([candidate("dwarf bust"), candidate("dwarf helm")])).toEqual(["dwarf"]);
  });
});
