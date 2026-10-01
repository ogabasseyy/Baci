import {
  getSkuMatrixValidationError,
  inferProductVariantModel,
  normalizeCanonicalProductCondition,
} from '@baci/shared';
import { z } from 'zod';
import { EDITABLE_PRODUCT_CONDITIONS } from '@/lib/product-condition';
import { buildVariantAttributeRecord } from '@/lib/product-variant-form';
import { sanitizeText, stripHtmlTags } from '@/lib/sanitize';
import { mapProductFormToProductDb } from './product-db-transform';

const variantAttributeSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const normalizedConditionSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeCanonicalProductCondition(trimmed);
  return normalized || trimmed;
}, z.enum(EDITABLE_PRODUCT_CONDITIONS).optional().nullable());

function isEditableCondition(
  value: string
): value is (typeof EDITABLE_PRODUCT_CONDITIONS)[number] {
  return EDITABLE_PRODUCT_CONDITIONS.includes(
    value as (typeof EDITABLE_PRODUCT_CONDITIONS)[number]
  );
}

const productVariantSchema = z.object({
  attributes: z.array(variantAttributeSchema).default([]),
  condition: normalizedConditionSchema,
  cost_price: z.number().min(0).optional().default(0),
  id: z.uuid().optional(),
  images: z.array(z.string()).default([]),
  price: z.number().min(0),
  primary_image: z.string().nullable().optional(),
  sku: z.string().optional().default(''),
  stock_quantity: z.number().int().min(0).optional().default(0),
});

export const ProductSchema = z
  .object({
    // Sanitize name to prevent XSS - strip all HTML
    name: z
      .string()
      .min(1, 'Product name is required')
      .transform((val) => sanitizeText(val, 200)),
    brand: z
      .string()
      .optional()
      .transform((val) => (val ? sanitizeText(val, 200) : val)),
    sku: z.string().optional().default(''),
    price: z.number().min(0),
    cost_price: z.number().min(0).optional().default(0),
    stock_quantity: z.number().int().min(0),
    low_stock_threshold: z.number().int().min(0).optional(),
    // Sanitize description to prevent XSS - strip HTML tags
    description: z
      .string()
      .optional()
      .transform((val) => (val ? stripHtmlTags(val) : val)),
    // We only care about category_id for the database
    category_id: z.uuid('Invalid Category ID').optional().or(z.literal('')),
    color: z.string().optional(),
    condition: normalizedConditionSchema.refine(
      (value) => value == null || isEditableCondition(value),
      {
        message: 'Condition must be a supported editable condition.',
      }
    ),
    manage_stock: z.boolean().default(true),
    status: z.enum(['active', 'draft', 'archived']).default('active'),
    images: z.array(z.string()).default([]),
    has_variants: z.boolean().default(false),

    // Frontend uses array of {key, value}, DB uses JSONB Record<string, any>
    // We accept the frontend format in the input, but transform it for the output
    variant_attributes: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        })
      )
      .optional()
      .default([]),

    fulfillment_details: z
      .object({
        items: z
          .array(
            z.object({
              imei: z.string().optional(),
              serial_number: z.string().optional(),
            })
          )
          .optional(),
      })
      .optional(),
    variants: z.array(productVariantSchema).default([]),
  })
  .superRefine((data, context) => {
    if (!data.has_variants && !data.sku.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SKU is required',
        path: ['sku'],
      });
    }

    if (!data.has_variants) {
      return;
    }

    if (data.variants.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one variant before saving.',
        path: ['variants'],
      });
      return;
    }

    const seenSignatures = new Set<string>();
    const variantModel = inferProductVariantModel({
      variants: data.variants.map((variant) => ({
        condition: variant.condition,
        price_override: variant.price,
      })),
    });
    const skuMatrixValidationError = getSkuMatrixValidationError({
      hasVariants: data.has_variants,
      variantModel,
      variants: data.variants.map((variant) => ({
        condition: variant.condition,
        price_override: variant.price,
      })),
    });

    if (skuMatrixValidationError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: skuMatrixValidationError,
        path: ['variants'],
      });
    }

    for (const [variantIndex, variant] of data.variants.entries()) {
      const normalizedCondition = variant.condition?.trim().toLowerCase() ?? '';
      const normalizedKeys = variant.attributes
        .map((attribute) => attribute.key.trim().toLowerCase())
        .filter(Boolean);

      if (normalizedKeys.length === 0 && !normalizedCondition) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each variant needs at least one attribute or condition.',
          path: ['variants', variantIndex],
        });
      }

      if (new Set(normalizedKeys).size < normalizedKeys.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each variant attribute key must be unique.',
          path: ['variants', variantIndex, 'attributes'],
        });
      }

      const signature = Object.entries(
        buildVariantAttributeRecord(variant.attributes)
      )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key.toLowerCase()}:${value.toLowerCase()}`)
        .join('|');
      const variantKey = `condition:${normalizedCondition}|${signature}`;

      if (!variantKey.replace('condition:|', '')) {
        continue;
      }

      if (seenSignatures.has(variantKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate variants must be merged or changed.',
          path: ['variants', variantIndex, 'attributes'],
        });
      }

      seenSignatures.add(variantKey);
    }
  });

// The type the form uses
export type ProductFormValues = z.infer<typeof ProductSchema>;

// The type the database expects (after transformation)
// attributes are reduced to a record
export const ProductDbSchema = ProductSchema.transform(
  mapProductFormToProductDb
);
