import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';
import { getOwnedSavingsGoals } from './wallet-savings-data';

export async function hydrateWalletSavingsProducts(rows: unknown[]) {
  const ownedGoals = getOwnedSavingsGoals(rows);
  const productsById = new Map<string, Record<string, unknown>>();
  const productIdByGoalId = new Map<string, string>();

  for (const goal of ownedGoals) {
    if (!goal.product_id) continue;
    const source = rows.find(
      (row) =>
        row && typeof row === 'object' && 'id' in row && row.id === goal.id
    );
    const product =
      source && typeof source === 'object' && 'products' in source
        ? source.products
        : undefined;
    if (!product || typeof product !== 'object' || Array.isArray(product))
      continue;
    const productRow = product as Record<string, unknown>;
    if (productRow.id !== goal.product_id) continue;
    productsById.set(goal.product_id, productRow);
    productIdByGoalId.set(goal.id, goal.product_id);
  }

  const productsByGoalId = new Map<string, Record<string, unknown>>();
  if (productsById.size === 0) return productsByGoalId;
  const variants = await getStorefrontProductVariantsByProductIds([
    ...productsById.keys(),
  ]);
  if (variants === null)
    throw new Error('Unable to load savings product variants');

  for (const [goalId, productId] of productIdByGoalId) {
    const product = productsById.get(productId);
    if (product)
      productsByGoalId.set(goalId, {
        ...product,
        variants: variants[productId] ?? [],
      });
  }
  return productsByGoalId;
}
