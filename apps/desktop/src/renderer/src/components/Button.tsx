import type { ButtonHTMLAttributes, ReactNode } from "react";

/** How much visual weight a button carries. */
export const BUTTON_TONE = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  QUIET: "quiet",
} as const;

/** One of the button tones. */
export type ButtonTone = (typeof BUTTON_TONE)[keyof typeof BUTTON_TONE];

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  children: ReactNode;
}

/*
 * Flat, single solid colour, square-ish corners, no shadow and no hover glow.
 * The project's design rules ask for a button from a government form rather
 * than from a marketing page, and this is a utility for moving files.
 */
const TONE_CLASSES: Record<ButtonTone, string> = {
  primary: "bg-primary text-background hover:bg-text disabled:bg-muted",
  secondary: "bg-surface text-text border border-border hover:border-text disabled:text-muted",
  quiet: "bg-transparent text-muted hover:text-text underline underline-offset-4",
};

export function Button({ tone = BUTTON_TONE.SECONDARY, children, className, ...rest }: Props) {
  const base =
    tone === BUTTON_TONE.QUIET
      ? "text-sm transition-colors disabled:cursor-not-allowed"
      : "px-4 py-2 text-sm rounded-md transition-colors disabled:cursor-not-allowed";

  return (
    <button className={`${base} ${TONE_CLASSES[tone]} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}
