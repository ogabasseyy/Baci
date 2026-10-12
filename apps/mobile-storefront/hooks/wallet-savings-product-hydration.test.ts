import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';
import { toActiveSavingsGoal } from './wallet-savings-data';
import { hydrateWalletSavingsProducts } from './wallet-savings-product-hydration';

jest.mock('@/lib/storefront-product-variants', () => ({
  getStorefrontProductVariantsByProductIds: jest.fn(),
}));

const goal = {
  id: 'goal-1',
  product_id: 'product-1',
  variant_id: null,
  title: 'Phone',
  contribution_amount: 10,
  contribution_frequency: 'weekly' as const,
  current_amount: 100,
  target_amount: 100,
  status: 'completed' as const,
  source_mode: 'manual' as const,
  maturity_date: '2026-10-04',
  products: { id: 'product-1', name: 'Phone', price: 100, variants: [] },
};
const variant = {
  id: 'variant-1',
  product_id: 'product-1',
  price_override: 100,
  attributes: { storage: '128GB' },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getStorefrontProductVariantsByProductIds)
    .mockResolvedValue({ 'product-1': [variant] });
});

it('hydrates RLS-hidden variants before unresolved completed-goal selection', async () => {
  const products = await hydrateWalletSavingsProducts([goal]);
  const mapped = toActiveSavingsGoal({ goal, product: products.get(goal.id) });
  expect(mapped?.selection_unresolved).toBe(true);
  expect(mapped?.variant_resolution_options).toEqual([
    { id: 'variant-1', label: 'Storage: 128GB' },
  ]);
});

it('preserves a selected RPC variant when the joined variants are empty', async () => {
  const selected = { ...goal, variant_id: variant.id };
  const products = await hydrateWalletSavingsProducts([selected]);
  expect(
    toActiveSavingsGoal({ goal: selected, product: products.get(goal.id) })
  ).toEqual(
    expect.objectContaining({
      selection_unresolved: false,
      product_variant_label: 'Storage: 128GB',
    })
  );
});

it('requests only deduplicated products from valid owned goals with exact joined ids', async () => {
  await hydrateWalletSavingsProducts([
    goal,
    { ...goal, id: 'goal-2' },
    { ...goal, id: 'goal-3', product_id: null },
    { ...goal, id: 'goal-4', product_id: 'other-product' },
    {
      ...goal,
      id: 'goal-5',
      status: 'cancelled',
      product_id: 'cancelled-product',
      products: { id: 'cancelled-product' },
    },
    { ...goal, id: 'goal-6', products: null },
  ]);
  expect(getStorefrontProductVariantsByProductIds).toHaveBeenCalledTimes(1);
  expect(getStorefrontProductVariantsByProductIds).toHaveBeenCalledWith([
    'product-1',
  ]);
});

it('skips the RPC for general goals and missing joined products', async () => {
  expect(
    await hydrateWalletSavingsProducts([
      { ...goal, product_id: null },
      { ...goal, id: 'goal-missing-product', products: null },
    ])
  ).toEqual(new Map());
  expect(getStorefrontProductVariantsByProductIds).not.toHaveBeenCalled();
});

it('keeps empty successful RPC results empty', async () => {
  jest.mocked(getStorefrontProductVariantsByProductIds).mockResolvedValue({});
  const products = await hydrateWalletSavingsProducts([goal]);
  expect(products.get(goal.id)?.variants).toEqual([]);
});

it.each([
  null,
  new Error('RPC failed'),
])('propagates variant lookup failures instead of reporting resolved selection', async (failure) => {
  if (failure instanceof Error)
    jest
      .mocked(getStorefrontProductVariantsByProductIds)
      .mockRejectedValue(failure);
  else
    jest
      .mocked(getStorefrontProductVariantsByProductIds)
      .mockResolvedValue(failure);
  await expect(hydrateWalletSavingsProducts([goal])).rejects.toThrow();
});
