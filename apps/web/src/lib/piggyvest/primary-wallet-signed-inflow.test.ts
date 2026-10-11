import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { applyPrimaryWalletSignedInflow } from './primary-wallet-signed-inflow';

vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-inflow-receipt', () => ({
  preparePrimaryWalletInflowReceipt: vi.fn((input: unknown) => {
    if (!input || typeof input !== 'object' || !('eventId' in input))
      throw new Error('Invalid');
    return { eventId: 'test-event', providerWalletId: 'test-wallet' };
  }),
}));
const secret = 'test-only-webhook-secret';
const rawBody = Buffer.from('{ "eventId": "test-event" }');
const signature = createHmac('sha512', secret).update(rawBody).digest('hex');

describe('primary wallet signed inflow boundary', () => {
  it('does not contact storage without valid original-byte authentication', async () => {
    const apply = vi.fn();
    for (const input of [
      { signature: null, secret },
      { signature, secret: undefined },
      { signature, secret },
    ]) {
      await expect(
        applyPrimaryWalletSignedInflow({
          ...input,
          rawBody: Buffer.from('{"eventId":"test-event"}'),
          apply,
        })
      ).rejects.toThrow('authentication failed');
    }
    expect(apply).not.toHaveBeenCalled();
  });
  it('passes only a sanitized receipt and digest after signature verification', async () => {
    const apply = vi.fn().mockResolvedValue('duplicate');
    expect(
      await applyPrimaryWalletSignedInflow({
        rawBody,
        signature,
        secret,
        apply,
      })
    ).toBe('duplicate');
    expect(apply).toHaveBeenCalledWith({
      eventId: 'test-event',
      providerWalletId: 'test-wallet',
      bodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  it('rejects authentic malformed UTF8 without storage writes', async () => {
    const body = Buffer.from([0xff]);
    const apply = vi.fn();
    await expect(
      applyPrimaryWalletSignedInflow({
        rawBody: body,
        signature: createHmac('sha512', secret).update(body).digest('hex'),
        secret,
        apply,
      })
    ).rejects.toThrow('Invalid wallet inflow receipt');
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not expose database errors or claim completion on ambiguous failure', async () => {
    const apply = vi
      .fn()
      .mockRejectedValue(new Error('private database detail'));
    await expect(
      applyPrimaryWalletSignedInflow({ rawBody, signature, secret, apply })
    ).rejects.toThrow('Wallet inflow reconciliation unavailable');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
