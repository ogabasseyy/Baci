/**
 * Flat Create Products contract, not the Retrieve Products response or the
 * legacy nested publisher. Verified 2026-10-24 against:
 * https://vendorcenter.jumia.com/api-docs/paths/feeds/feeds@products@create.yaml
 *
 * Baci is stricter than the wire's optional currency/number fields: required
 * text is nonempty, top-level currency is explicit, prices are finite/positive,
 * and stock is a nonnegative integer. No coercion, trimming or defaults.
 *
 * This unused foundation does NOT establish authorization, canonical source,
 * destination policy, safe content, image quality, family validity or readiness.
 * Sale schedules and category-required attributes need later preflight checks.
 */
import { z } from 'zod';

const text = z.string().min(1);
const positivePrice = z.number().positive();

// Neither translation property is required in the provider's Create schema.
const translation = z.looseObject({
  language: z.string().optional(),
  value: z.string().optional(),
});
const translatedText = z.looseObject({
  value: text,
  translations: z.array(translation).optional(),
});
const codeAndName = z.looseObject({ code: z.number(), name: text });

const salePrice = z.looseObject({
  value: positivePrice.optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});
const localSalePrice = z.looseObject({
  value: positivePrice.nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
});

export const JumiaCreateProductSchema = z.looseObject({
  name: translatedText,
  description: translatedText,
  parentSku: text,
  sellerSku: text,
  variation: text,
  gtinBarcode: z.string().optional(),
  brand: codeAndName,
  category: codeAndName,
  // Deprecated but still documented; both properties are optional on the wire.
  additionalCategories: z
    .array(
      z.looseObject({
        code: z.number().optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
  images: z
    .array(
      z.looseObject({
        url: z.url(),
        primary: z.boolean(),
      })
    )
    .min(1)
    .refine(
      (images) => images.filter((image) => image.primary).length === 1,
      'Exactly one primary image is required.'
    ),
  price: z.looseObject({
    currency: text,
    value: positivePrice,
    salePrice: salePrice.optional(),
  }),
  // Optional generic wire shape, NOT a selected-marketplace policy or proof.
  businessClients: z
    .array(
      z.looseObject({
        businessClientCode: z.string().optional(),
        price: z
          .looseObject({
            currency: z.string().optional(),
            value: positivePrice.optional(),
            salePrice: localSalePrice.nullable().optional(),
          })
          .optional(),
      })
    )
    .optional(),
  stock: z.int().nonnegative(),
  attributes: z.array(
    z.looseObject({
      name: z.string(),
      value: z.string(),
      translations: z.array(translation).optional(),
    })
  ),
  // Preserve optional future provider fields, but never accept obsolete shapes.
  variations: z.never().optional(),
  globalPrice: z.never().optional(),
});

export type JumiaCreateProduct = z.infer<typeof JumiaCreateProductSchema>;
