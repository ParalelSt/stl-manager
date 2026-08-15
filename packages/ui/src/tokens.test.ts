import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLORS, FONTS, RADIUS_MD } from "./tokens.js";

const css = readFileSync(join(import.meta.dirname, "index.css"), "utf8");

/**
 * tokens.ts documents the palette; index.css is what Tailwind reads. Nothing
 * stops the two drifting apart except this test.
 */
describe("the palette", () => {
  it("declares exactly seven colours", () => {
    expect(Object.keys(COLORS)).toHaveLength(7);
  });

  it.each(Object.entries(COLORS))("defines --color-%s as %s in the stylesheet", (name, value) => {
    expect(css).toContain(`--color-${name}: ${value};`);
  });

  it("defines both font stacks in the stylesheet", () => {
    expect(css).toContain(`--font-sans: ${FONTS.sans};`);
    expect(css).toContain(`--font-serif: ${FONTS.serif};`);
  });

  it("caps the corner radius at the documented value", () => {
    expect(css).toContain(`--radius-md: ${RADIUS_MD};`);
  });

  it("pairs one sans with one serif rather than two sans", () => {
    expect(FONTS.serif.toLowerCase()).toContain("georgia");
    expect(FONTS.sans.toLowerCase()).toContain("system-ui");
  });
});
