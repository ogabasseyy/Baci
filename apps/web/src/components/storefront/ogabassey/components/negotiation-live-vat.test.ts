import { describe, expect, it, vi } from 'vitest';
import { readNegotiationVatRate } from './negotiation-live-vat';

function client(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { rpc, abortSignal };
}
function row(status: string, rate: number | null, id = 'merchant-1') {
  return [
    {
      resolution_status: 'found',
      merchant_data: { id, vat_registration_status: status, vat_rate: rate },
    },
  ];
}
describe('fresh negotiation VAT', () => {
  it.each([
    ['not_registered', 7.5, 0],
    ['registered', 7.5, 0.075],
  ])('uses live %s status rather than an earlier snapshot', async (status, rate, expected) => {
    const supabase = client(row(status, rate));
    await expect(
      readNegotiationVatRate(
        supabase as never,
        'shop',
        'merchant-1',
        new AbortController().signal
      )
    ).resolves.toBe(expected);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      { p_identifier: 'shop' }
    );
  });
  it.each([
    [row('registered', 7.5, 'other-merchant'), null],
    [null, { message: 'unavailable' }],
    [row('unknown', 7.5), null],
    [row('registered', null), null],
  ])('fails closed for untrusted or unavailable data', async (data, error) => {
    await expect(
      readNegotiationVatRate(
        client(data, error) as never,
        'shop',
        'merchant-1',
        new AbortController().signal
      )
    ).rejects.toThrow();
  });
});
