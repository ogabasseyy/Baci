import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllowlist, parseAllowlist } from './qa-allowlist';
import { HarnessRefusal } from './safety-guards';

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

const GOOD = '20000000-0000-4000-8000-000000000001';

describe('parseAllowlist', () => {
  it('accepts a list of opaque QA customer keys', () => {
    expect(
      parseAllowlist(JSON.stringify({ qaCustomerIds: [GOOD, 'qa-customer-2'] }))
        .qaCustomerIds
    ).toEqual([GOOD, 'qa-customer-2']);
  });

  it.each([
    ['not json', '{nope'],
    ['not an object', '[]'],
    ['missing key', '{}'],
    ['empty list', '{"qaCustomerIds":[]}'],
    ['non-string entry', '{"qaCustomerIds":[1]}'],
    ['too short', '{"qaCustomerIds":["abc"]}'],
    ['whitespace in id', '{"qaCustomerIds":["qa customer 1"]}'],
    ['duplicates', `{"qaCustomerIds":["${GOOD}","${GOOD}"]}`],
    ['unknown extra key', `{"qaCustomerIds":["${GOOD}"],"extra":true}`],
    [
      'two keys that derive the same synthetic BVN',
      '{"qaCustomerIds":["qa-customer-011234","qa-customer-012514"]}',
    ],
    [
      'too many entries',
      JSON.stringify({
        qaCustomerIds: Array.from(
          { length: 21 },
          (_, i) => `qa-customer-${i}0`
        ),
      }),
    ],
  ])('refuses %s', (_label, text) => {
    expect(code(() => parseAllowlist(text))).toBe('ALLOWLIST_INVALID');
  });

  it('hard-refuses anything related to the recording account', () => {
    expect(
      code(() =>
        parseAllowlist('{"qaCustomerIds":["baci-recording-20261013-qa"]}')
      )
    ).toBe('RECORDING_ACCOUNT');
    expect(
      code(() =>
        parseAllowlist(
          JSON.stringify({
            qaCustomerIds: [GOOD],
            note: 'baci-recording-20261013@example.com',
          })
        )
      )
    ).toBe('RECORDING_ACCOUNT');
  });
});

describe('loadAllowlist', () => {
  function tempFile(content: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pvb-allowlist-'));
    const file = path.join(dir, 'allowlist.json');
    writeFileSync(file, content);
    return file;
  }

  it('reads and validates a file', () => {
    const file = tempFile(JSON.stringify({ qaCustomerIds: [GOOD] }));
    expect(loadAllowlist(file).qaCustomerIds).toEqual([GOOD]);
  });

  it('refuses a missing file and an oversized file', () => {
    expect(code(() => loadAllowlist('/nonexistent/allowlist.json'))).toBe(
      'ALLOWLIST_INVALID'
    );
    expect(code(() => loadAllowlist(tempFile('x'.repeat(40_000))))).toBe(
      'ALLOWLIST_INVALID'
    );
  });
});
