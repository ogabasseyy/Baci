import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import {
  isRestricted,
  sendWalletPayTransferOnce,
} from './wallet-pay-send-once';

vi.mock('server-only', () => ({}));

const reservation = { reference: 'pvb-pay-x' };
function ports(overrides: Record<string, unknown> = {}) {
  return {
    claimDispatch: vi.fn(async () => true),
    transfer: vi.fn(async () => ({ accepted: true as const })),
    lookupTransfer: vi.fn(async () => 'not_found' as const),
    releaseAfterRejection: vi.fn(async () => true),
    ...overrides,
  };
}
const rejected = new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 400);

describe('sendWalletPayTransferOnce', () => {
  it('posts once after winning the dispatch claim', async () => {
    const p = ports();
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
    expect(p.transfer).toHaveBeenCalledTimes(1);
  });

  it('never posts when the dispatch claim is lost', async () => {
    const p = ports({ claimDispatch: vi.fn(async () => false) });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('holds a malformed acceptance pending (it may have been sent)', async () => {
    const p = ports({ transfer: vi.fn(async () => ({ accepted: false })) });
    await expect(
      sendWalletPayTransferOnce(reservation, p as never)
    ).resolves.toBe('pending');
    expect(p.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it('holds an ambiguous failure pending without a lookup', async () => {
    const p = ports({
      transfer: vi.fn(async () =>
        Promise.reject(
          new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
        )
      ),
    });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
    expect(p.lookupTransfer).not.toHaveBeenCalled();
  });

  it.each([
    'submitted',
    'pending',
    'failed',
    'uncertain',
  ] as const)('keeps a definitive rejection pending when the lookup says %s', async (lookup) => {
    const p = ports({
      transfer: vi.fn(async () => Promise.reject(rejected)),
      lookupTransfer: vi.fn(async () => lookup),
    });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
    expect(p.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it('keeps it pending when the lookup itself throws', async () => {
    const p = ports({
      transfer: vi.fn(async () => Promise.reject(rejected)),
      lookupTransfer: vi.fn(async () => Promise.reject(new Error('down'))),
    });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
  });

  it('releases a definitive rejection with nothing under the reference', async () => {
    const p = ports({ transfer: vi.fn(async () => Promise.reject(rejected)) });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'released'
    );
  });

  it('reports pending when the release transition itself is refused', async () => {
    const p = ports({
      transfer: vi.fn(async () => Promise.reject(rejected)),
      releaseAfterRejection: vi.fn(async () => false),
    });
    await expect(sendWalletPayTransferOnce(reservation, p)).resolves.toBe(
      'pending'
    );
  });
});

describe('isRestricted', () => {
  it('is unrestricted only when both flags are explicitly false', () => {
    expect(isRestricted({ is_frozen: false, has_an_active_lien: false })).toBe(
      false
    );
    expect(isRestricted({ is_frozen: true, has_an_active_lien: false })).toBe(
      true
    );
    expect(isRestricted({ is_frozen: false, has_an_active_lien: true })).toBe(
      true
    );
    expect(isRestricted({ is_frozen: false })).toBe(true);
    expect(isRestricted({ is_frozen: null, has_an_active_lien: false })).toBe(
      true
    );
    expect(isRestricted({})).toBe(true);
  });
});
