// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_SURFACE_EVIDENCE_COLUMNS,
  AGENT_SURFACES,
  type SurfaceEvidenceError,
  type SurfaceEvidenceResult,
  validateAgentSurfaceEvidence,
} from './agent-surface-evidence';

const COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function validRow(surface: string): Record<string, string> {
  return {
    Surface: surface,
    Partner: 'Example partner',
    'Protocol version': '2026-04-08',
    Merchant: 'Example merchant',
    'Source revision': COMMIT,
    'Local test': 'pass 2026-10-31 [test](../../apps/web/example.test.ts)',
    Staging: 'unknown',
    Production:
      'fail 2026-10-31 [baseline](../superpowers/evidence/example.md)',
    'Partner receipt': 'not applicable',
    'Market and currency': 'Nigeria, NGN',
    'Eligible products': 'Example products',
    Authentication: 'Example authentication',
    'Next check owner': 'Example owner',
  };
}

function renderTable(
  rows: Record<string, string>[],
  columns: readonly string[] = AGENT_SURFACE_EVIDENCE_COLUMNS
): string {
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => row[c] ?? '').join(' | ')} |`),
  ].join('\n');
}

function document(table: string): string {
  return `# Map\n\n## Other table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Agent surface evidence\n\nLegend text.\n\n${table}\n\n## Next section\n\n| Surface |\n| --- |\n| ignored |\n`;
}

function allRows(): Record<string, string>[] {
  return AGENT_SURFACES.map((surface) => validRow(surface));
}

function failure(result: SurfaceEvidenceResult): SurfaceEvidenceError[] {
  if (result.ok) throw new Error('Expected validation to fail');
  return [...result.errors];
}

function codes(result: SurfaceEvidenceResult): string[] {
  return failure(result).map((error) => error.code);
}

describe('validateAgentSurfaceEvidence', () => {
  it('accepts a complete table and returns the rows in order', () => {
    const result = validateAgentSurfaceEvidence(
      document(renderTable(allRows()))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.Surface)).toEqual([...AGENT_SURFACES]);
    expect(result.rows[0]['Source revision']).toBe(COMMIT);
  });

  it('accepts unknown source revisions and unknown statuses', () => {
    const rows = allRows().map((row) => ({
      ...row,
      'Source revision': 'unknown',
      'Local test': 'unknown',
      Production: 'unknown',
    }));

    expect(validateAgentSurfaceEvidence(document(renderTable(rows))).ok).toBe(
      true
    );
  });

  it('reports a missing section', () => {
    expect(
      codes(validateAgentSurfaceEvidence('# Map\n\nNo table here.\n'))
    ).toEqual(['section_missing']);
  });

  it('reports a section without a table', () => {
    const markdown =
      '## Agent surface evidence\n\nOnly prose here.\n\n## Next\n';
    expect(codes(validateAgentSurfaceEvidence(markdown))).toEqual([
      'table_missing',
    ]);
  });

  it('reports a table without a separator row', () => {
    const markdown = `## Agent surface evidence\n\n| ${AGENT_SURFACE_EVIDENCE_COLUMNS.join(' | ')} |\n`;
    expect(codes(validateAgentSurfaceEvidence(markdown))).toEqual([
      'table_missing',
    ]);
  });

  it('reports renamed, reordered and missing columns', () => {
    const renamed: string[] = [...AGENT_SURFACE_EVIDENCE_COLUMNS];
    renamed[7] = 'Live';
    const reordered = [...AGENT_SURFACE_EVIDENCE_COLUMNS].reverse();
    const missing = AGENT_SURFACE_EVIDENCE_COLUMNS.slice(0, 12);

    for (const columns of [renamed, reordered, missing]) {
      expect(
        codes(
          validateAgentSurfaceEvidence(
            document(renderTable(allRows(), columns))
          )
        )
      ).toEqual(['columns_mismatch']);
    }
  });

  it('reports rows with the wrong number of cells', () => {
    const table = `${renderTable(allRows())}\n| Extra row | only | three |`;
    expect(codes(validateAgentSurfaceEvidence(document(table)))).toEqual([
      'row_width',
    ]);
  });

  it('reports unknown, duplicate and missing surfaces', () => {
    const rows = allRows();
    rows[0] = validRow('Apple Pay');
    rows[6] = validRow('Google UCP cart');

    const errors = failure(
      validateAgentSurfaceEvidence(document(renderTable(rows)))
    );

    expect(errors.map((error) => error.code)).toEqual([
      'surface_unknown',
      'surface_duplicate',
      'surface_missing',
      'surface_missing',
    ]);
    expect(
      errors
        .filter((error) => error.code === 'surface_missing')
        .map((error) => error.surface)
    ).toEqual(['OpenAI MCP handoff', 'Multi-merchant onboarding']);
  });

  it.each([
    '',
    '-',
    '—',
    'TBD',
    'todo',
    'n/a',
  ])('rejects the empty cell %j', (value) => {
    const rows = allRows();
    rows[2] = { ...rows[2], Authentication: value };

    const errors = failure(
      validateAgentSurfaceEvidence(document(renderTable(rows)))
    );

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'empty_cell',
        column: 'Authentication',
        surface: 'Google UCP cart',
      }),
    ]);
  });

  it.each([
    'verified',
    'live',
    'ok',
    'pass',
    'fail',
    'Unknown',
    'passed 2026-10-31 [test](x.md)',
    'pass 2026-10-31',
    'pass 2026-10-31 verified',
    'pass 2026-10-31 abc12',
    'pass 2026-10-31 ABCDEF1',
    'pass 2026-13-01 [test](x.md)',
    'pass 2026-02-30 [test](x.md)',
    'pass 26-10-31 [test](x.md)',
    'pass 2026-10-31 [](x.md)',
    'pass 2026-10-31 [test]()',
  ])('rejects the status %j in every status column', (value) => {
    for (const column of [
      'Local test',
      'Staging',
      'Production',
      'Partner receipt',
    ]) {
      const rows = allRows();
      rows[4] = { ...rows[4], [column]: value };

      const errors = failure(
        validateAgentSurfaceEvidence(document(renderTable(rows)))
      );

      expect(errors).toEqual([
        expect.objectContaining({
          code: 'invalid_status',
          column,
          surface: 'Paystack-hosted Google Pay',
        }),
      ]);
    }
  });

  it.each([
    'source revision',
    'abc1234',
    '9C9D6FCE39FFA8BF7CB66309C378B79FB75B5382',
    '9c9d6fce39ffa8bf7cb66309c378b79fb75b538',
    'verified',
  ])('rejects the source revision %j', (value) => {
    const rows = allRows();
    rows[1] = { ...rows[1], 'Source revision': value };

    expect(
      failure(validateAgentSurfaceEvidence(document(renderTable(rows))))
    ).toEqual([
      expect.objectContaining({
        code: 'invalid_source_revision',
        surface: 'ACP direct checkout',
      }),
    ]);
  });

  it('reports every problem instead of stopping at the first', () => {
    const rows = allRows();
    rows[0] = { ...rows[0], Production: 'live', 'Source revision': 'abc' };
    rows[3] = { ...rows[3], Merchant: '' };

    expect(
      codes(validateAgentSurfaceEvidence(document(renderTable(rows))))
    ).toEqual(['invalid_status', 'invalid_source_revision', 'empty_cell']);
  });
});
