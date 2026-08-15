/**
 * Returns a count with a correctly pluralised noun.
 *
 * @param count - How many
 * @param singular - The noun in its singular form
 * @param plural - The plural form, when it is not simply the singular plus "s"
 * @returns For example "1 file" or "3 files"
 */
export function plural(count: number, singular: string, plural?: string): string {
  const noun = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count.toLocaleString()} ${noun}`;
}

/**
 * Returns "was" or "were" to agree with a count.
 *
 * @param count - How many
 * @returns The verb form matching the count
 */
export function wasWere(count: number): string {
  return count === 1 ? "was" : "were";
}

/**
 * Formats a byte count for display.
 *
 * @param bytes - The size in bytes
 * @returns A short human readable size, for example "4.2 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
