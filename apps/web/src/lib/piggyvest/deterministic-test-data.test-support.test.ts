import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  deterministicTestKey,
  deterministicTestSignature,
  deterministicTestUuid,
} from './deterministic-test-data.test-support';

describe('deterministicTestKey', () => {
  it('is stable for a label, distinct across labels, and 64 hex characters', () => {
    expect(deterministicTestKey('a')).toBe(deterministicTestKey('a'));
    expect(deterministicTestKey('a')).not.toBe(deterministicTestKey('b'));
    expect(deterministicTestKey('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('deterministicTestSignature', () => {
  it('is stable, distinct across labels, and in the 128-hex signature shape', () => {
    expect(deterministicTestSignature('a')).toBe(
      deterministicTestSignature('a')
    );
    expect(deterministicTestSignature('a')).not.toBe(
      deterministicTestSignature('b')
    );
    expect(deterministicTestSignature('a')).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe('deterministicTestUuid', () => {
  it('is stable and distinct per label', () => {
    expect(deterministicTestUuid('row:1')).toBe(deterministicTestUuid('row:1'));
    expect(deterministicTestUuid('row:1')).not.toBe(
      deterministicTestUuid('row:2')
    );
  });

  it('is an RFC 4122 version-4 UUID that the capture schemas accept', () => {
    const labels = Array.from({ length: 200 }, (_, index) => `label:${index}`);

    for (const label of labels) {
      const uuid = deterministicTestUuid(label);
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(z.uuid().safeParse(uuid).success).toBe(true);
    }
  });
});
