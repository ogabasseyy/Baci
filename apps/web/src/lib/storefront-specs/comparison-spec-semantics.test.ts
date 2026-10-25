import { describe, expect, it } from 'vitest';
import {
  isDecisionSpec,
  isDocumentedComparisonValue,
  normalizeComparisonLabel,
  normalizeComparisonValue,
} from './comparison-spec-semantics';

describe('comparison spec semantics', () => {
  it('preserves explicit negative capability facts and zero rather than treating them as missing', () => {
    for (const value of [false, 0, 'No', 'Not supported'])
      expect(isDocumentedComparisonValue(value)).toBe(true);
    for (const value of [
      null,
      undefined,
      'Unknown',
      'Not documented',
      'Not applicable',
      'Conflicting catalog values (verify): A; B',
    ])
      expect(isDocumentedComparisonValue(value)).toBe(false);
  });
  it('excludes identity and provenance from buyer advantages while retaining capability fields', () => {
    for (const label of ['canonical_model', 'source_url', 'part-number'])
      expect(isDecisionSpec(label)).toBe(false);
    for (const label of ['GPU', 'Battery runtime', 'Refresh Rate'])
      expect(isDecisionSpec(label)).toBe(true);
  });
  it('coalesces harmless formatting without guessing unsupported feature equivalence', () => {
    expect(normalizeComparisonLabel('CPU/GPU')).toBe(
      normalizeComparisonLabel('CPU / GPU')
    );
    expect(normalizeComparisonValue('1920 × 1080')).toBe(
      normalizeComparisonValue('1920x1080')
    );
    expect(normalizeComparisonValue('Supported')).not.toBe(
      normalizeComparisonValue('Not supported')
    );
  });
});
