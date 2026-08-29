import { SORTING_PROFILE } from "@stl-manager/core";
import { describe, expect, it } from "vitest";
import { rememberedFrom, toRemembered } from "./persistence.js";

describe("rememberedFrom", () => {
  it("keeps the folders and the layout", () => {
    expect(
      rememberedFrom({
        libraryRoot: "/lib",
        scanRoots: ["/a", "/b"],
        profile: SORTING_PROFILE.TYPE,
      }),
    ).toEqual({ libraryRoot: "/lib", scanRoots: ["/a", "/b"], profile: SORTING_PROFILE.TYPE });
  });

  it("keeps nothing else", () => {
    const state = {
      libraryRoot: "/lib",
      scanRoots: ["/a"],
      profile: SORTING_PROFILE.FAMILY,
      plan: { groups: [] },
      screen: "review",
      progress: { done: 3 },
    };
    expect(Object.keys(rememberedFrom(state))).toEqual([
      "libraryRoot",
      "scanRoots",
      "profile",
    ]);
  });
});

describe("toRemembered", () => {
  it("reads back what was stored", () => {
    expect(
      toRemembered({ libraryRoot: "/lib", scanRoots: ["/a"], profile: "source" }),
    ).toEqual({ libraryRoot: "/lib", scanRoots: ["/a"], profile: SORTING_PROFILE.SOURCE });
  });

  it("falls back to the default layout rather than discarding the folders", () => {
    // What a library sorted before the layout could be chosen reads back as.
    expect(toRemembered({ libraryRoot: "/lib", scanRoots: ["/a"] })).toEqual({
      libraryRoot: "/lib",
      scanRoots: ["/a"],
      profile: SORTING_PROFILE.FAMILY,
    });
  });

  it("refuses a layout that is not one the application offers", () => {
    expect(toRemembered({ scanRoots: [], profile: "../../etc" }).profile).toBe(
      SORTING_PROFILE.FAMILY,
    );
  });

  it("reads nothing from an empty or absent value", () => {
    const empty = {
      libraryRoot: undefined,
      scanRoots: [],
      profile: SORTING_PROFILE.FAMILY,
    };
    expect(toRemembered(undefined)).toEqual(empty);
    expect(toRemembered(null)).toEqual(empty);
    expect(toRemembered("nonsense")).toEqual(empty);
    expect(toRemembered({})).toEqual(empty);
  });

  it("drops a library root that is not a usable string", () => {
    expect(toRemembered({ libraryRoot: 42 }).libraryRoot).toBeUndefined();
    expect(toRemembered({ libraryRoot: "" }).libraryRoot).toBeUndefined();
  });

  it("drops scan roots that are not usable strings", () => {
    expect(toRemembered({ scanRoots: ["/a", 42, "", null] }).scanRoots).toEqual(["/a"]);
  });

  it("drops duplicates, since the interface treats the list as a set", () => {
    expect(toRemembered({ scanRoots: ["/a", "/a", "/b"] }).scanRoots).toEqual(["/a", "/b"]);
  });

  it("reads nothing when scanRoots is not a list", () => {
    expect(toRemembered({ scanRoots: "/a" }).scanRoots).toEqual([]);
  });
});
