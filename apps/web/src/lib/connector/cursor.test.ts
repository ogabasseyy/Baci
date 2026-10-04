import { describe, expect, it } from 'vitest';
import {
  advanceCursor,
  branchFilterHash,
  decodeConnectorCursor,
  encodeConnectorCursor,
  initialCursorFor,
  isCursorBoundTo,
} from '@/lib/connector/cursor';

const BINDING = {
  grantId: '66666666-6666-6666-6666-666666666666',
  merchantId: '11111111-1111-1111-1111-111111111111',
  branchIds: ['44444444-4444-4444-4444-444444444444'],
};

describe('connector cursor rules', () => {
  it('round-trips a cursor bound to its grant', () => {
    const cursor = initialCursorFor(BINDING);
    const decoded = decodeConnectorCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.position).toBe(0);
    expect(decoded !== null && isCursorBoundTo(decoded, BINDING)).toBe(true);
  });

  it('rejects cursors from another grant, merchant, or branch filter', () => {
    const decoded = decodeConnectorCursor(initialCursorFor(BINDING));
    expect(decoded).not.toBeNull();
    if (decoded === null) return;

    expect(
      isCursorBoundTo(decoded, { ...BINDING, grantId: 'other-grant' })
    ).toBe(false);
    expect(
      isCursorBoundTo(decoded, { ...BINDING, merchantId: 'other-merchant' })
    ).toBe(false);
    expect(isCursorBoundTo(decoded, { ...BINDING, branchIds: [] })).toBe(false);
    expect(isCursorBoundTo(decoded, { ...BINDING, branchIds: null })).toBe(
      false
    );
  });

  it('rejects malformed cursors', () => {
    expect(decodeConnectorCursor('not-a-cursor')).toBeNull();
    expect(
      decodeConnectorCursor(
        Buffer.from(JSON.stringify({ v: 999 }), 'utf8').toString('base64url')
      )
    ).toBeNull();
  });

  it('advances only to the highest returned position and never backwards', () => {
    const start = decodeConnectorCursor(initialCursorFor(BINDING));
    expect(start).not.toBeNull();
    if (start === null) return;

    const advanced = advanceCursor(start, 7);
    expect(advanced.position).toBe(7);

    // Empty reads preserve the cursor; late lower positions never regress it.
    expect(advanceCursor(advanced, null).position).toBe(7);
    expect(advanceCursor(advanced, 5).position).toBe(7);
  });

  it('hashes branch filters order-independently', () => {
    expect(branchFilterHash(['b', 'a'])).toBe(branchFilterHash(['a', 'b']));
    expect(branchFilterHash(['a'])).not.toBe(branchFilterHash(['b']));
    expect(branchFilterHash(null)).toBe('merchant');
  });

  it('encodes positions without gaps in the payload contract', () => {
    const payload = {
      v: 1,
      grantId: BINDING.grantId,
      merchantId: BINDING.merchantId,
      branchHash: branchFilterHash(BINDING.branchIds),
      position: 3,
    };
    expect(decodeConnectorCursor(encodeConnectorCursor(payload))).toEqual(
      payload
    );
  });
});
