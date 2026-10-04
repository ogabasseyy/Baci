import { z } from 'zod';
import {
  getPrimaryProductImage,
  normalizeProductImages,
} from '@/lib/product-normalization';
import {
  formatProductConditionDisplay,
  formatVariantAxisLabel,
} from '@/types/product';
import type { WalletActiveSavingsGoal } from './wallet-query';

const SavingsGoalDataSchema = z.object({
  contribution_amount: z.union([z.number(), z.string()]),
  contribution_frequency: z.enum(['daily', 'weekly', 'monthly']),
  current_amount: z.union([z.number(), z.string()]),
  id: z.string(),
  maturity_date: z.string(),
  product_id: z.string().nullable().optional(),
  product_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  source_mode: z.enum(['manual', 'auto_debit']),
  status: z.enum(['active', 'paused', 'completed']),
  target_amount: z.union([z.number(), z.string()]),
  title: z.string(),
  variant_id: z.string().nullable(),
});

const SavingsProductVariantSchema = z.object({
  attributes: z.record(z.string(), z.string()).nullable().optional(),
  condition: z.string().nullable().optional(),
  id: z.string(),
  is_inventory_anchor: z.boolean().nullable().optional(),
  image: z.string().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  name: z.string().nullable().optional(),
  primary_image: z.string().nullable().optional(),
  price_override: z.union([z.number(), z.string()]).nullable().optional(),
  sku: z.string().nullable().optional(),
});

const SavingsProductDataSchema = z.object({
  condition: z.string().nullable().optional(),
  id: z.string(),
  images: z.array(z.string()).nullable().optional(),
  name: z.string(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  variants: z.array(SavingsProductVariantSchema).nullable().optional(),
});

export type SavingsGoalData = z.infer<typeof SavingsGoalDataSchema>;

function coerceDatabaseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value.trim());
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function getSnapshotText(
  snapshot: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  for (const key of keys) {
    const value = snapshot?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getVariantLabel(
  variant: NonNullable<
    z.infer<typeof SavingsProductDataSchema>['variants']
  >[number]
) {
  const attributeParts = Object.entries(variant.attributes ?? {})
    .filter(([, value]) => value)
    .map(([axis, value]) => {
      const axisLabel = formatVariantAxisLabel(axis) ?? axis;
      return `${axisLabel}: ${value}`;
    });

  return attributeParts.length > 0
    ? attributeParts.join(' · ')
    : variant.name?.trim() || variant.sku?.trim() || null;
}

function getVariantResolutionOptions({
  maximumPrice,
  product,
  variants,
}: {
  maximumPrice: number;
  product: z.infer<typeof SavingsProductDataSchema>;
  variants: NonNullable<z.infer<typeof SavingsProductDataSchema>['variants']>;
}) {
  const productPrice = coerceDatabaseNumber(product.price);
  if (!Number.isFinite(maximumPrice) || maximumPrice <= 0) {
    return undefined;
  }

  const options = variants.reduce<{ id: string; label: string }[]>(
    (result, variant) => {
      const price =
        coerceDatabaseNumber(variant.price_override) ?? productPrice;
      if (
        price === null ||
        !Number.isFinite(price) ||
        price <= 0 ||
        price > maximumPrice
      ) {
        return result;
      }

      const condition = formatProductConditionDisplay(variant.condition);
      const variantLabel = getVariantLabel(variant);
      const label = [condition, variantLabel]
        .filter((value): value is string => Boolean(value))
        .join(' · ');
      if (!label) {
        return result;
      }

      result.push({ id: variant.id, label });
      return result;
    },
    []
  );

  return options.length > 0 ? options : undefined;
}

export function getActiveSavingsGoal(rows: unknown[]): SavingsGoalData | null {
  const goals = rows.reduce<SavingsGoalData[]>((result, row) => {
    const validation = SavingsGoalDataSchema.safeParse(row);
    if (validation.success) {
      result.push(validation.data);
    }
    return result;
  }, []);

  return (
    goals.find((goal) => goal.status === 'active') ??
    goals.find((goal) => goal.status === 'paused') ??
    goals.find((goal) => goal.status === 'completed') ??
    null
  );
}

export function toActiveSavingsGoal({
  goal,
  product,
}: {
  goal: SavingsGoalData;
  product?: unknown;
}): WalletActiveSavingsGoal | null {
  const currentAmount = coerceDatabaseNumber(goal.current_amount);
  const targetAmount = coerceDatabaseNumber(goal.target_amount);
  const contributionAmount = coerceDatabaseNumber(goal.contribution_amount);
  if (
    currentAmount === null ||
    targetAmount === null ||
    contributionAmount === null
  ) {
    return null;
  }

  const snapshot = goal.product_snapshot ?? {};
  const productValidation = SavingsProductDataSchema.safeParse(product);
  const productData = productValidation.success ? productValidation.data : null;
  const customerVariants = productData?.variants?.filter(
    (variant) => variant.is_inventory_anchor !== true
  );
  const selectedVariant =
    goal.variant_id && customerVariants
      ? customerVariants.find((variant) => variant.id === goal.variant_id)
      : null;
  const selectedVariantSingleImage =
    selectedVariant?.primary_image?.trim() ||
    selectedVariant?.image?.trim() ||
    null;
  const variantImages = selectedVariant?.images?.length
    ? normalizeProductImages(selectedVariant.images)
    : selectedVariantSingleImage
      ? normalizeProductImages([selectedVariantSingleImage])
      : undefined;
  const productImages =
    variantImages ??
    (productData?.images
      ? normalizeProductImages(productData.images)
      : undefined);
  const snapshotImage = getSnapshotText(snapshot, [
    'image',
    'imageUrl',
    'image_url',
    'productImage',
    'product_image',
  ]);
  const productCondition =
    formatProductConditionDisplay(
      selectedVariant?.condition ?? productData?.condition
    ) ??
    getSnapshotText(snapshot, ['condition', 'productCondition']) ??
    null;
  const productHasVariants = (customerVariants?.length ?? 0) > 0;
  const selectionUnresolved =
    productHasVariants &&
    (!goal.variant_id || (Boolean(goal.variant_id) && !selectedVariant));
  const productVariantLabel = selectionUnresolved
    ? 'Exact variant unavailable'
    : ((selectedVariant ? getVariantLabel(selectedVariant) : null) ??
      getSnapshotText(snapshot, [
        'variantLabel',
        'variant_label',
        'storage',
        'storageLabel',
      ]));
  const variantResolutionOptions =
    productData && selectionUnresolved && goal.status === 'completed'
      ? getVariantResolutionOptions({
          maximumPrice: Math.min(currentAmount, targetAmount),
          product: productData,
          variants: customerVariants ?? [],
        })
      : undefined;

  return {
    contribution_amount: contributionAmount,
    contribution_frequency: goal.contribution_frequency,
    current_amount: currentAmount,
    id: goal.id,
    maturity_date: goal.maturity_date,
    product_condition: productCondition,
    product_image:
      snapshotImage ??
      (productImages ? getPrimaryProductImage(productImages) : null),
    product_variant_label: productVariantLabel,
    selection_unresolved: selectionUnresolved,
    source_mode: goal.source_mode,
    status: goal.status,
    target_amount: targetAmount,
    title: goal.title,
    ...(variantResolutionOptions
      ? { variant_resolution_options: variantResolutionOptions }
      : {}),
  };
}
