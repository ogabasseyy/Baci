import { parseSurfaceStatus } from './agent-surface-status';

const AGENT_SURFACE_EVIDENCE_HEADING = '## Agent surface evidence';

export const AGENT_SURFACE_EVIDENCE_COLUMNS = [
  'Surface',
  'Partner',
  'Protocol version',
  'Merchant',
  'Source revision',
  'Local test',
  'Staging',
  'Production',
  'Partner receipt',
  'Market and currency',
  'Eligible products',
  'Authentication',
  'Next check owner',
] as const;

export const AGENT_SURFACES = [
  'OpenAI MCP handoff',
  'ACP direct checkout',
  'Google UCP cart',
  'Google UCP native checkout',
  'Paystack-hosted Google Pay',
  'First-party storefront chat',
  'Multi-merchant onboarding',
] as const;

const STATUS_COLUMNS = [
  'Local test',
  'Staging',
  'Production',
  'Partner receipt',
] as const;

type Column = (typeof AGENT_SURFACE_EVIDENCE_COLUMNS)[number];

type SurfaceEvidenceRow = Readonly<Record<Column, string>>;

type SurfaceEvidenceErrorCode =
  | 'section_missing'
  | 'table_missing'
  | 'columns_mismatch'
  | 'row_width'
  | 'surface_unknown'
  | 'surface_duplicate'
  | 'surface_missing'
  | 'empty_cell'
  | 'invalid_status'
  | 'invalid_source_revision';

export interface SurfaceEvidenceError {
  readonly code: SurfaceEvidenceErrorCode;
  readonly message: string;
  readonly surface?: string;
  readonly column?: string;
}

export type SurfaceEvidenceResult =
  | { readonly ok: true; readonly rows: readonly SurfaceEvidenceRow[] }
  | { readonly ok: false; readonly errors: readonly SurfaceEvidenceError[] };

const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
const EMPTY_CELL = /^(?:[-–—]*|tbd|todo|n\/a)$/i;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|unknown)$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function findTable(markdown: string): string[] | SurfaceEvidenceError {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim() === AGENT_SURFACE_EVIDENCE_HEADING
  );
  if (start === -1) {
    return {
      code: 'section_missing',
      message: `Missing the "${AGENT_SURFACE_EVIDENCE_HEADING}" section.`,
    };
  }
  const table: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().startsWith('|')) {
      table.push(line);
    } else if (table.length > 0) {
      break;
    }
  }
  if (table.length < 2 || !SEPARATOR_ROW.test(table[1].trim())) {
    return {
      code: 'table_missing',
      message: `"${AGENT_SURFACE_EVIDENCE_HEADING}" needs a Markdown table with a header and separator row.`,
    };
  }
  return table;
}

function validateRow(
  row: SurfaceEvidenceRow,
  seen: Set<string>
): SurfaceEvidenceError[] {
  const errors: SurfaceEvidenceError[] = [];
  const surface = row.Surface;
  const known = (AGENT_SURFACES as readonly string[]).includes(surface);
  if (surface && !known) {
    errors.push({
      code: 'surface_unknown',
      message: `"${surface}" is not one of the seven tracked surfaces.`,
      surface,
    });
  } else if (known && seen.has(surface)) {
    errors.push({
      code: 'surface_duplicate',
      message: `"${surface}" appears more than once.`,
      surface,
    });
  }
  seen.add(surface);

  for (const column of AGENT_SURFACE_EVIDENCE_COLUMNS) {
    if (EMPTY_CELL.test(row[column])) {
      errors.push({
        code: 'empty_cell',
        message: `${surface || '(row)'}: "${column}" is empty; write unknown or not applicable explicitly.`,
        surface,
        column,
      });
    }
  }
  for (const column of STATUS_COLUMNS) {
    if (!EMPTY_CELL.test(row[column]) && !parseSurfaceStatus(row[column])) {
      errors.push({
        code: 'invalid_status',
        message: `${surface}: "${column}" must be unknown, not applicable, or pass/fail YYYY-MM-DD plus a Markdown link or commit; got "${row[column]}".`,
        surface,
        column,
      });
    }
  }
  const revision = row['Source revision'];
  if (!EMPTY_CELL.test(revision) && !SOURCE_REVISION.test(revision)) {
    errors.push({
      code: 'invalid_source_revision',
      message: `${surface}: "Source revision" must be a 40-character commit SHA or unknown; got "${revision}".`,
      surface,
      column: 'Source revision',
    });
  }
  return errors;
}

/** Validates the "Agent surface evidence" table in docs/product/agent-access-map.md. */
export function validateAgentSurfaceEvidence(
  markdown: string
): SurfaceEvidenceResult {
  const table = findTable(markdown);
  if (!Array.isArray(table)) return { ok: false, errors: [table] };

  const header = splitRow(table[0]);
  if (header.join('|') !== AGENT_SURFACE_EVIDENCE_COLUMNS.join('|')) {
    return {
      ok: false,
      errors: [
        {
          code: 'columns_mismatch',
          message: `Columns must be exactly: ${AGENT_SURFACE_EVIDENCE_COLUMNS.join(' | ')}. Got: ${header.join(' | ')}.`,
        },
      ],
    };
  }

  const errors: SurfaceEvidenceError[] = [];
  const rows: SurfaceEvidenceRow[] = [];
  const seen = new Set<string>();
  for (const line of table.slice(2)) {
    const cells = splitRow(line);
    if (cells.length !== AGENT_SURFACE_EVIDENCE_COLUMNS.length) {
      errors.push({
        code: 'row_width',
        message: `Row "${cells[0]}" has ${cells.length} cells; expected ${AGENT_SURFACE_EVIDENCE_COLUMNS.length}.`,
        surface: cells[0],
      });
      continue;
    }
    const row = Object.fromEntries(
      AGENT_SURFACE_EVIDENCE_COLUMNS.map((column, index) => [
        column,
        cells[index],
      ])
    ) as Record<Column, string>;
    rows.push(row);
    errors.push(...validateRow(row, seen));
  }
  for (const surface of AGENT_SURFACES) {
    if (!seen.has(surface)) {
      errors.push({
        code: 'surface_missing',
        message: `Missing a row for "${surface}".`,
        surface,
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}
