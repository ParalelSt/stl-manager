/**
 * The application palette. Seven colours, no more.
 *
 * Declared here rather than scattered through class names so the choice is
 * visible and reviewable. The accent is ochre, picked deliberately: this is a
 * utility for sorting files, and it should not look like every other product
 * built on default blue.
 *
 * These values are mirrored in index.css, which is what Tailwind actually
 * reads. tokens.test.ts asserts the two never drift apart.
 */
export const COLORS = {
  background: "#faf9f6",
  surface: "#ffffff",
  text: "#1c1b18",
  muted: "#6b6862",
  border: "#dedbd2",
  primary: "#2b2a26",
  accent: "#b8860b",
} as const;

/** One of the palette's colour names. */
export type ColorName = keyof typeof COLORS;

/**
 * The type pairing: one sans for the interface, one serif for headings.
 *
 * Both are already present on macOS and Linux, so the application ships no
 * font files and works with no network access at all.
 */
export const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
} as const;

/**
 * The largest corner radius used anywhere.
 *
 * Corners stay square or nearly so. Nothing in this application is a marketing
 * card, and rounded-2xl is forbidden outright by the project's design rules.
 */
export const RADIUS_MD = "0.375rem";

/** The spacing step everything aligns to. */
export const SPACING_STEP_PX = 8;
