import { describe, expect, it } from 'vitest';
import { validateEventPipelineSelection } from './event-pipeline-database';

describe('validateEventPipelineSelection', () => {
  it('validates allowed, unauthorized, nested, and wildcard projections', () => {
    const findings: string[] = [];
    const columnsForTable = (table: string) =>
      new Set(table === 'orders' ? ['id', 'items'] : ['id', 'name']);

    validateEventPipelineSelection(
      'worker.ts',
      'orders',
      'id,items(id,name)',
      findings,
      columnsForTable
    );
    expect(findings).toEqual([]);

    validateEventPipelineSelection(
      'worker.ts',
      'orders',
      'secret,items(secret),*,items(*)',
      findings,
      columnsForTable
    );
    expect(findings).toEqual([
      'worker.ts: unauthorized orders column secret',
      'worker.ts: unauthorized items column secret',
      'worker.ts: unauthorized orders wildcard projection',
      'worker.ts: unauthorized items wildcard projection',
    ]);
  });
});
