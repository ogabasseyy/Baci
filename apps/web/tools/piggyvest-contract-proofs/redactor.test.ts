import { describe, expect, it } from 'vitest';
import { Redactor } from './redactor';
import { HarnessRefusal } from './safety-guards';
import { SENSITIVE } from './sensitive-fixtures.test-support';

const leaksOf = (text: string) => new Redactor().leaks(text);

describe('Redactor pseudonyms', () => {
  it('assigns stable, per-kind, per-run pseudonyms', () => {
    const redactor = new Redactor();
    expect(redactor.register('W', SENSITIVE.uuid)).toBe('W1');
    expect(redactor.register('W', SENSITIVE.ulid)).toBe('W2');
    expect(redactor.register('W', SENSITIVE.uuid)).toBe('W1');
    expect(redactor.register('C', 'customer-id-aaaa')).toBe('C1');
    expect(redactor.pseudonym(SENSITIVE.ulid)).toBe('W2');
    expect(redactor.pseudonym('never-registered')).toBeNull();
  });

  it('ignores empty and too-short values instead of replacing everywhere', () => {
    const redactor = new Redactor();
    expect(redactor.register('W', '')).toBeNull();
    expect(redactor.register('W', null)).toBeNull();
    expect(redactor.register('W', 'ok')).toBeNull();
    expect(redactor.text('ok then')).toBe('ok then');
  });

  it('never serialises the real-to-pseudonym map', () => {
    const redactor = new Redactor();
    redactor.register('W', SENSITIVE.uuid);
    expect(JSON.stringify(redactor)).not.toContain(SENSITIVE.uuid);
    expect(String(redactor)).not.toContain(SENSITIVE.uuid);
  });
});

describe('Redactor.text', () => {
  it('replaces registered values, longest first', () => {
    const redactor = new Redactor();
    redactor.register('R', 'pvbproof-run1-wallet_transfer');
    redactor.register('R', SENSITIVE.reference);
    expect(redactor.text(`ref ${SENSITIVE.reference} done`)).toBe(
      'ref R2 done'
    );
  });

  it('masks every sensitive type even when it was never registered', () => {
    const redactor = new Redactor();
    // Names have no pattern: they are only safe because they are registered
    // (or, as in shape.ts, because string values are never emitted).
    redactor.register('N', SENSITIVE.personName);
    redactor.register('N', SENSITIVE.accountName);
    const dirty = Object.values(SENSITIVE).join(' | ');
    const clean = redactor.text(dirty);
    for (const value of Object.values(SENSITIVE)) {
      expect(clean).not.toContain(value);
    }
    expect(redactor.leaks(clean)).toEqual([]);
  });

  it('masks provider message numbers so amounts and balances cannot leak', () => {
    const redactor = new Redactor();
    expect(
      redactor.message('Insufficient funds: available 50000 needed 100000')
    ).toBe('Insufficient funds: available # needed #');
    expect(redactor.message('x'.repeat(300)).length).toBeLessThanOrEqual(160);
  });
});

describe('Redactor.leaks / assertClean', () => {
  it.each([
    ['email', SENSITIVE.email, 'email'],
    ['international phone', SENSITIVE.phoneIntl, 'phone'],
    ['spaced phone', SENSITIVE.phoneSpaced, 'phone'],
    ['local phone / BVN-length digits', SENSITIVE.phoneLocal, 'digit-run'],
    ['BVN', SENSITIVE.bvn, 'digit-run'],
    ['account number', SENSITIVE.nuban, 'digit-run'],
    ['uuid wallet/customer id', SENSITIVE.uuid, 'uuid'],
    ['ulid provider id', SENSITIVE.ulid, 'ulid'],
    ['test api key', SENSITIVE.testKey, 'api-key'],
    ['live api key', SENSITIVE.liveKey, 'api-key'],
    ['bearer header', SENSITIVE.bearer, 'bearer-token'],
    ['long hex secret', SENSITIVE.hex, 'long-hex'],
    ['recording account', SENSITIVE.recording, 'protected-account-reference'],
  ])('detects %s', (_name, value, label) => {
    expect(leaksOf(`value: ${value}`)).toContain(label);
  });

  it('detects a registered value that survived into the output', () => {
    const redactor = new Redactor();
    redactor.register('Q', 'qa-customer-secretname');
    expect(redactor.leaks('hello qa-customer-secretname')).toContain(
      'registered-value'
    );
  });

  it('passes clean evidence prose with pseudonyms and type-level facts', () => {
    expect(
      leaksOf('W1 and W2 differ; withdrawal_count: integer; fee_kobo: 5000')
    ).toEqual([]);
  });

  it('assertClean throws labels only, never the leaked value', () => {
    const redactor = new Redactor();
    try {
      redactor.assertClean(`oops ${SENSITIVE.email} and ${SENSITIVE.testKey}`);
      throw new Error('expected a leak refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessRefusal);
      expect((error as HarnessRefusal).code).toBe('EVIDENCE_LEAK');
      expect((error as Error).message).toContain('email');
      expect((error as Error).message).not.toContain('jane.doe');
      expect((error as Error).message).not.toContain('SuperSecret');
    }
  });
});
