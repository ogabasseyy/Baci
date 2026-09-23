import { describe, expect, it } from 'vitest';
import { mapOrderPatchUpdateError } from './map-order-patch-update-error';

describe('mapOrderPatchUpdateError', () => {
  it('maps active shipping charge address edit blocks to 409', async () => {
    const response = mapOrderPatchUpdateError({
      message: 'active_shipping_charge_address_edit_blocked',
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: 'active_shipping_charge_address_edit_blocked',
      error:
        'Shipping address cannot change while a wallet shipping charge is active.',
    });
  });

  it('maps active shipping charge quote replacement blocks to 409', async () => {
    const response = mapOrderPatchUpdateError({
      message: 'active_shipping_charge_quote_replacement_blocked',
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: 'active_shipping_charge_quote_replacement_blocked',
      error:
        'Shipping quote cannot change while a wallet shipping charge is active.',
    });
  });

  it('returns null for unrelated update errors', () => {
    expect(
      mapOrderPatchUpdateError({ message: 'Failed to update order' })
    ).toBeNull();
  });
});
