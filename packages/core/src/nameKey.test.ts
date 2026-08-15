import { describe, expect, it } from "vitest";
import { parseDuplicateIndex, toNameKey } from "./nameKey.js";

describe("toNameKey", () => {
  it("lowercases and collapses separators", () => {
    expect(toNameKey("Space_Marine-Captain")).toBe("space marine captain");
  });

  it("strips a parenthesised duplicate suffix", () => {
    expect(toNameKey("tower (3)")).toBe("tower");
    expect(toNameKey("tower(3)")).toBe("tower");
  });

  it("strips a copy suffix with or without a number", () => {
    expect(toNameKey("tower copy")).toBe("tower");
    expect(toNameKey("tower copy 2")).toBe("tower");
  });

  it("strips nested duplicate suffixes", () => {
    expect(toNameKey("tower (1) copy (2)")).toBe("tower");
  });

  it("keeps a trailing number that is not a duplicate marker", () => {
    expect(toNameKey("tower 2")).toBe("tower 2");
  });

  it("keeps a number that is part of the name", () => {
    expect(toNameKey("base_32mm")).toBe("base 32mm");
  });

  it("preserves unicode and emoji", () => {
    expect(toNameKey("Dragón_Rojo")).toBe("dragón rojo");
    expect(toNameKey("hero-🐉")).toBe("hero 🐉");
  });

  it("collapses repeated whitespace and trims", () => {
    expect(toNameKey("  tower__-  a ")).toBe("tower a");
  });

  it("returns an empty string for a stem that is only separators", () => {
    expect(toNameKey("___")).toBe("");
  });

  it("returns an empty string for a stem that is only a duplicate marker", () => {
    expect(toNameKey("(1)")).toBe("");
  });

  it("does not strip parentheses that carry meaning", () => {
    expect(toNameKey("tower (damaged)")).toBe("tower (damaged)");
  });
});

describe("parseDuplicateIndex", () => {
  it("reads a parenthesised index", () => {
    expect(parseDuplicateIndex("tower (3)")).toBe(3);
  });

  it("reads a copy index", () => {
    expect(parseDuplicateIndex("tower copy 2")).toBe(2);
    expect(parseDuplicateIndex("tower copy")).toBe(1);
  });

  it("returns undefined when there is no duplicate marker", () => {
    expect(parseDuplicateIndex("tower")).toBeUndefined();
    expect(parseDuplicateIndex("tower 2")).toBeUndefined();
  });

  it("returns undefined for parentheses holding a word", () => {
    expect(parseDuplicateIndex("tower (damaged)")).toBeUndefined();
  });

  it("reads the outermost index when suffixes are nested", () => {
    expect(parseDuplicateIndex("tower (1) copy (2)")).toBe(2);
  });
});
