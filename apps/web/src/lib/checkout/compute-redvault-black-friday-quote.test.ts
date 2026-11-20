import { allocateRedvaultRefund } from '@baci/shared/lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { computeRedvaultOrderQuote } from './compute-redvault-order-quote';

const campaign = vi.hoisted(() => ({ approved: ['approved-budget-phone'] }));
vi.mock('@/config/ogabassey-black-friday', () => ({
  APPROVED_BLACK_FRIDAY_PRODUCT_SLUGS: campaign.approved,
  BLACK_FRIDAY_PRODUCT_SLUGS: ['approved-budget-phone', 'samsung-galaxy-a08'],
}));

const products = [
  {
    id: 'campaign',
    slug: 'approved-budget-phone',
    brand: 'Tecno',
    name: 'Camon',
  },
  {
    id: 'sample',
    slug: 'samsung-galaxy-a08',
    brand: 'Samsung',
    name: 'Galaxy A08',
  },
  { id: 'regular', slug: 'iphone', brand: 'Apple', name: 'iPhone' },
].map((product) => ({
  ...product,
  price: 1000,
  condition: 'new',
  vat_category_code: 'S',
  vat_rate: 7.5,
}));

function quote(merchantId = OGABASSEY_MERCHANT_ID) {
  const eq = vi.fn().mockReturnValue({
    in: () => ({
      overrideTypes: async () => ({ data: products, error: null }),
    }),
  });
  const result = computeRedvaultOrderQuote({
    merchantId,
    items: products.map((product) => ({
      product_id: product.id,
      quantity: 2,
      price: 1,
    })),
    supabase: { from: () => ({ select: () => ({ eq }) }) } as never,
  });
  expect(eq).toHaveBeenCalledWith('merchant_id', merchantId);
  return result;
}

describe('Black Friday RedVault authoritative quotes', () => {
  beforeEach(() => {
    campaign.approved.splice(
      0,
      campaign.approved.length,
      'approved-budget-phone'
    );
  });

  it('adds approved products to regular eligibility at 5% in mixed carts', async () => {
    const result = await quote();
    expect(result.productSubtotalKobo).toBe(600000);
    expect(result.eligibleSubtotalKobo).toBe(400000);
    expect(result.discountKobo).toBe(20000);
    expect(result.lines.map((line) => line.discountKobo)).toEqual([
      10000, 0, 10000,
    ]);
    expect(result.groups.map((group) => group.productId)).toEqual([
      'campaign',
      'regular',
    ]);
    expect(result.productSubtotalKobo - result.discountKobo).toBe(580000);
  });

  it('removes campaign eligibility when removed from the approved lineup', async () => {
    campaign.approved.splice(0);
    const result = await quote();
    expect(result.eligibleSubtotalKobo).toBe(200000);
    expect(result.lines.map((line) => line.discountKobo)).toEqual([
      0, 0, 10000,
    ]);
  });

  it('never grants campaign eligibility to another merchant', async () => {
    const result = await quote('another-merchant');
    expect(result.lines.map((line) => line.discountKobo)).toEqual([
      0, 0, 10000,
    ]);
  });

  it('refunds the stored net allocation even after lineup removal', async () => {
    const result = await quote();
    const line = result.lines[0];
    campaign.approved.splice(0);
    expect(
      allocateRedvaultRefund(
        {
          itemId: line.productId,
          unitNetAmountsKobo: line.unitDiscountsKobo.map(
            (discount) => line.unitPriceKobo - discount
          ),
        },
        [0]
      )
    ).toEqual({ refundKobo: 95000, unitNetAmountsKobo: [95000] });
  });
});
