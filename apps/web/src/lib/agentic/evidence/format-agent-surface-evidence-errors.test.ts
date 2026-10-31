// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatSurfaceEvidenceErrors } from './format-agent-surface-evidence-errors';

describe('formatSurfaceEvidenceErrors', () => {
  it('prefixes each message with its code', () => {
    expect(
      formatSurfaceEvidenceErrors([
        { code: 'surface_missing', message: 'Missing a row.' },
      ])
    ).toEqual(['surface_missing: Missing a row.']);
  });
});
