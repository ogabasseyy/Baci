import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN,
  PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME_PATTERN,
  readPiggyvestPrimaryDbPoolerProjectRef,
  readPiggyvestPrimaryDbTlsServerName,
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

describe('readPiggyvestPrimaryDbTlsServerName', () => {
  const NAME = 'db.abcdefghijklmnopqrst.supabase.co';

  it('returns the configured server name', () => {
    expect(
      readPiggyvestPrimaryDbTlsServerName({
        PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME: NAME,
      })
    ).toBe(NAME);
  });

  it('treats an absent or blank value as unset', () => {
    expect(readPiggyvestPrimaryDbTlsServerName({})).toBeUndefined();
    expect(
      readPiggyvestPrimaryDbTlsServerName({
        PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME: '',
      })
    ).toBeUndefined();
  });

  it('returns a malformed value unchanged so the executors fail closed', () => {
    expect(
      readPiggyvestPrimaryDbTlsServerName({
        PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME: 'pg-relay.usebaci.com',
      })
    ).toBe('pg-relay.usebaci.com');
  });

  it.each([
    NAME,
    'db.zzzzzzzzzzzzzzzzzzzz.supabase.co',
  ])('pattern accepts %s', (v) => {
    expect(PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME_PATTERN.test(v)).toBe(true);
  });

  it.each([
    'pg-relay.usebaci.com',
    'db.short.supabase.co',
    `${NAME}.evil.com`,
    `x${NAME}`,
    'db.ABCDEFGHIJKLMNOPQRST.supabase.co',
  ])('pattern rejects %s', (v) => {
    expect(PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME_PATTERN.test(v)).toBe(false);
  });
});
