// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { UCP_SCHEMA_SAMPLE_CASES } from './ucp-schema-samples';
import { UCP_SCHEMAS, validateUcpDocument } from './ucp-schema-validator';

describe('UCP schema samples', () => {
  it('cover every schema reference the validator exposes, once each', () => {
    const covered = UCP_SCHEMA_SAMPLE_CASES.map(({ ref }) => ref).sort();

    expect(covered).toEqual(Object.values(UCP_SCHEMAS).sort());
  });

  it.each(UCP_SCHEMA_SAMPLE_CASES)('accepts a valid $name sample', ({
    ref,
    valid,
  }) => {
    expect(validateUcpDocument(ref, valid)).toEqual({
      errors: [],
      valid: true,
    });
  });

  it.each(UCP_SCHEMA_SAMPLE_CASES)('rejects an invalid $name sample', ({
    invalid,
    invalidError,
    ref,
  }) => {
    const result = validateUcpDocument(ref, invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(invalidError);
  });
});
