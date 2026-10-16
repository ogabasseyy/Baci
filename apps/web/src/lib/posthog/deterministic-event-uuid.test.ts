import { describe, expect, it } from 'vitest';
import { deterministicEventUuid } from './deterministic-event-uuid';

const UUID_V5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicEventUuid', () => {
  it.each([
    [
      'wallet_funding_transfer_credited:tx-1',
      '8894f167-9847-5243-bc94-70d3367f3e25',
    ],
    [
      'wallet_funding_transfer_credited:tx-2',
      '59b4e794-bfcd-5ba6-b9c7-0288da553b7b',
    ],
    ['', 'a92077a0-e15d-5ead-ac52-fdd75723b2b5'],
    ['é', 'baa0de5f-b1e6-5073-b614-4323d58d0b80'],
    ['e\u0301', 'e733754d-4986-5803-b413-bda69275176a'],
    ['order:😀', '3fa8065c-4981-5531-8b7f-18265f19f534'],
  ])('preserves deployed deduplication identity for %j', (name, expected) => {
    expect(deterministicEventUuid(name)).toBe(expected);
  });
  it('produces a valid RFC 4122 v5 uuid', () => {
    expect(
      deterministicEventUuid('wallet_funding_transfer_credited:tx-1')
    ).toMatch(UUID_V5_PATTERN);
  });

  it('is stable for the same name so concurrent emitters dedupe', () => {
    const first = deterministicEventUuid(
      'wallet_funding_transfer_credited:tx-1'
    );
    const second = deterministicEventUuid(
      'wallet_funding_transfer_credited:tx-1'
    );

    expect(first).toBe(second);
  });

  it('differs across names so distinct events are never merged', () => {
    expect(
      deterministicEventUuid('wallet_funding_transfer_credited:tx-1')
    ).not.toBe(deterministicEventUuid('wallet_funding_transfer_credited:tx-2'));
  });
});
