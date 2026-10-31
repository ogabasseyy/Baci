const STATUS_WITH_EVIDENCE = /^(pass|fail) (\d{4}-\d{2}-\d{2}) (.+)$/;
const MARKDOWN_LINK = /^\[[^\]\n]+\]\([^)\s]+\)$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

type SurfaceStatus =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not_applicable' }
  | {
      readonly kind: 'pass' | 'fail';
      readonly date: string;
      readonly evidence: string;
    };

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Parses one status cell. Only an explicit `unknown`, `not applicable`, or a
 * dated `pass`/`fail` with a link or commit as evidence is accepted, so an
 * unproven surface can never read as success.
 */
export function parseSurfaceStatus(cell: string): SurfaceStatus | null {
  if (cell === 'unknown') return { kind: 'unknown' };
  if (cell === 'not applicable') return { kind: 'not_applicable' };
  const match = STATUS_WITH_EVIDENCE.exec(cell);
  if (!match) return null;
  const [, kind, date, evidence] = match;
  if (!isCalendarDate(date)) return null;
  if (!MARKDOWN_LINK.test(evidence) && !COMMIT.test(evidence)) return null;
  return { kind: kind as 'pass' | 'fail', date, evidence };
}
