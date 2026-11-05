import { describe, expect, it } from 'vitest';
import z from 'zod';
import {
  PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN,
  piggyvestServerEnvShape,
  readPiggyvestServerEnv,
} from './piggyvest-env';

const schema = z.object(piggyvestServerEnvShape);

describe('piggyvest server env', () => {
  it('reads both PiggyVest entries from the given source', () => {
    expect(
      readPiggyvestServerEnv({
        PIGGYVEST_SECRET_KEY: 'sk',
        PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: 'abcdefghijklmnopqrst',
        OTHER: 'ignored',
      })
    ).toEqual({
      PIGGYVEST_SECRET_KEY: 'sk',
      PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: 'abcdefghijklmnopqrst',
    });
  });

  it('never fails boot, including for a malformed pooler ref', () => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({ PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: 'BAD REF' })
        .success
    ).toBe(true);
  });

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
