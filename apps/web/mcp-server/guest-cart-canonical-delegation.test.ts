import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readGuestCartMigration,
  updateGuestCartWithCanonical,
} from './guest-cart-canonical-delegation';
import {
  GuestCartBridgePendingError,
  GuestCartCanonicalError,
} from './guest-cart-errors';

const token = 'a'.repeat(64);
const line = {
  product_id: '223E4567-E89B-12D3-A456-426614174000',
  quantity: 2,
  expectedVersion: 4,
  operationId: 'retry-op',
};
const result = { cart_token: token, items: [], expires_at: '2030-01-01' };
const canonical = { update: vi.fn(), hasToken: vi.fn() };
const validate = vi.fn();
const recordStorageError = vi.fn();
const updateLegacy = vi.fn();
const input = {
  token,
  line,
  canonical,
  validate,
  recordStorageError,
  updateLegacy,
};

beforeEach(() => {
  vi.resetAllMocks();
  canonical.update.mockResolvedValue(result);
  updateLegacy.mockResolvedValue(result);
});

describe('canonical guest-cart delegation', () => {
  it('validates changed positive lines and preserves retry identity through canonical writes', async () => {
    expect(await updateGuestCartWithCanonical(input)).toBe(result);
    expect(validate).toHaveBeenCalledWith([
      { product_id: line.product_id.toLowerCase(), quantity: 2 },
    ]);
    expect(canonical.update).toHaveBeenCalledWith(token, {
      ...line,
      product_id: line.product_id.toLowerCase(),
    });
    expect(updateLegacy).not.toHaveBeenCalled();
    expect(recordStorageError).toHaveBeenLastCalledWith(null);
  });
  it('removes a canonical line without requiring catalog availability', async () => {
    await updateGuestCartWithCanonical({
      ...input,
      line: { ...line, quantity: 0 },
    });
    expect(validate).not.toHaveBeenCalled();
    expect(updateLegacy).not.toHaveBeenCalled();
  });
  it('retains the newly persisted token when migration or handoff transport fails', async () => {
    canonical.update.mockRejectedValue(
      new GuestCartCanonicalError('temporarily_unavailable', token)
    );
    await expect(
      updateGuestCartWithCanonical({ ...input, token: undefined })
    ).rejects.toBeInstanceOf(GuestCartBridgePendingError);
    expect(updateLegacy).toHaveBeenCalledOnce();
    expect(canonical.update).toHaveBeenCalledWith(
      token,
      expect.objectContaining({ operationId: 'retry-op' })
    );
    expect(recordStorageError).toHaveBeenLastCalledWith('bridge_unavailable');
  });
  it('retains typed refresh failures without retrying legacy writes or degrading health', async () => {
    const failure = new GuestCartCanonicalError('version_conflict', token);
    canonical.update.mockRejectedValue(failure);
    await expect(updateGuestCartWithCanonical(input)).rejects.toBe(failure);
    expect(updateLegacy).not.toHaveBeenCalled();
    expect(recordStorageError).not.toHaveBeenCalled();
  });
  it('normalizes only the persisted migration pointer', async () => {
    expect(
      await readGuestCartMigration(async () => [
        { migrated_to_cart_id: 'canonical-id' },
      ])
    ).toBe('canonical-id');
    expect(
      await readGuestCartMigration(async () => [{ migrated_to_cart_id: null }])
    ).toBeNull();
  });
});
