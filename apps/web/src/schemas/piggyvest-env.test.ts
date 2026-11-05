import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN,
  readPiggyvestPrimaryDbPoolerProjectRef,
} from './piggyvest-env';

describe('readPiggyvestPrimaryDbPoolerProjectRef', () => {
  it('returns the configured ref', () => {
    expect(
      readPiggyvestPrimaryDbPoolerProjectRef({
        PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: 'abcdefghijklmnopqrst',
      })
    ).toBe('abcdefghijklmnopqrst');
  });

  it('treats an absent or blank ref as pooler mode off', () => {
    expect(readPiggyvestPrimaryDbPoolerProjectRef({})).toBeUndefined();
    expect(
      readPiggyvestPrimaryDbPoolerProjectRef({
        PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: '',
      })
    ).toBeUndefined();
  });

  it('returns a malformed ref unchanged so the executors fail closed', () => {
    expect(
      readPiggyvestPrimaryDbPoolerProjectRef({
        PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: 'BAD REF',
      })
    ).toBe('BAD REF');
  });
});

describe('PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN', () => {
  it('accepts only a 20-character lowercase project ref', () => {
    expect(
      PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN.test(
        'abcdefghij0123456789'
      )
    ).toBe(true);
    for (const ref of [
      'ABCDEFGHIJKLMNOPQRST',
      'short',
      'abcdefghijklmnopqrstu',
    ]) {
      expect(PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN.test(ref)).toBe(
        false
      );
    }
  });
});
