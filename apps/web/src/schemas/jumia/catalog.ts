/**
 * Jumia Vendor Center API — Catalog schemas (products, categories, brands,
 * attribute sets, stock)
 */

import { z } from 'zod';

// ── Brands ──

const JumiaBrandSchema = z.object({
  code: z.int(),
  name: z.string(),
});

const JumiaPageMetadataSchema = z.object({
  current: z.int(),
  totalOfPages: z.int(),
});

export const JumiaBrandsResponseSchema = z.object({
  brands: z.array(JumiaBrandSchema),
  page: JumiaPageMetadataSchema,
});

// ── Products ──

const JumiaTranslation = z.object({
  language: z.string(),
  value: z.string(),
});

export const JumiaAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: z.string(),
  translations: z.array(JumiaTranslation),
});

export const JumiaSalePriceSchema = z.object({
  value: z.number().nonnegative(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
});

export const JumiaGlobalPriceSchema = z.object({
  value: z.number().nonnegative(),
  updateAt: z.iso.datetime({ offset: true }),
  salePrice: JumiaSalePriceSchema.nullable().optional(),
});

export const JumiaVariationSchema = z.object({
  id: z.string(),
  sellerSku: z.string(),
  barcodeEan: z
    .string()
    .refine(
      (v) => v === '' || /^\d{8}(\d{5})?$/.test(v),
      'Must be empty or a valid EAN-8 or EAN-13 barcode'
    )
    .optional(),
  variation: z.string(),
  globalPrice: JumiaGlobalPriceSchema,
  attributes: z.array(JumiaAttributeSchema),
});

export const JumiaProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  parentSku: z.string().min(1),
  shop: z.object({ id: z.string() }),
  brand: JumiaBrandSchema,
  category: z.object({ code: z.int(), name: z.string() }),
  images: z.array(
    z.object({
      url: z.url(),
      originalUrl: z.url(),
      primary: z.boolean(),
    })
  ),
  attributeSetId: z.string(),
  attributes: z.array(JumiaAttributeSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  variations: z.array(JumiaVariationSchema),
});

export const JumiaProductsResponseSchema = z.object({
  products: z.array(JumiaProductSchema),
  nextToken: z.string().nullable(),
  isLastPage: z.boolean(),
});

// ── Categories ──

export const JumiaCategorySchema = z.object({
  code: z.int(),
  name: z.string().min(1),
  completePath: z.string().min(1),
  hasChildren: z.boolean(),
  attributeSet: z.object({
    sid: z.uuid(),
    name: z.string(),
  }),
});

export const JumiaCategoriesResponseSchema = z.object({
  categories: z.array(JumiaCategorySchema),
  page: JumiaPageMetadataSchema,
});

// ── Attribute Sets ──

// Option translation properties are all optional in the provider schema.
const JumiaAttributeOptionTranslation = z.object({
  languageId: z.number().optional(),
  languageCode: z.string().optional(),
  translation: z.string().optional(),
});

const JumiaAttributeOption = z.object({
  id: z.number(),
  sid: z.uuid(),
  name: z.string(),
  position: z.number(),
  isDefault: z.boolean(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']),
  translations: z.array(JumiaAttributeOptionTranslation).optional(),
});

const JumiaAttributeTranslation = z.object({
  languageCode: z.string(),
  translation: z.string(),
  languageId: z.number().optional(),
});

const JumiaAttributeValidation = z.object({
  dateFormat: z.string().nullable().optional(),
  decimalPlaces: z.number().nullable().optional(),
  maxLength: z.number().nullable().optional(),
  minLength: z.number().nullable().optional(),
  percentage: z.boolean().nullable().optional(),
  notZeroOrNegative: z.boolean().nullable().optional(),
  selectedByDefault: z.boolean().nullable().optional(),
});

const JumiaAttributeDefinition = z.object({
  code: z.number(),
  name: z.string(),
  description: z.string(),
  // TEXT, TEXT_AREA, NUMBER, MULTI_SELECTION, SELECTION, DATE, BOOLEAN,
  // DATE_TIME, NUMBER_FLOAT. Unknown required types fail at the wire boundary.
  type: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
  ]),
  mandatory: z.boolean(),
  variation: z.boolean(),
  translatable: z.boolean(),
  sid: z.uuid().optional(),
  translations: z.array(JumiaAttributeTranslation).optional(),
  options: z.array(JumiaAttributeOption).optional(),
  validations: JumiaAttributeValidation.optional(),
});

export const JumiaAttributeSetResponseSchema = z.object({
  attributes: z.array(JumiaAttributeDefinition),
});

// ── Stock ──

export const JumiaStockResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      sellerSku: z.string(),
      globalStock: z.int().nonnegative(),
      lastStockUpdatedAt: z.iso.datetime({ offset: true }),
    })
  ),
  nextToken: z.string().nullable(),
  isLastPage: z.boolean(),
});

// ── Inferred types ──

export type JumiaProductsResponse = z.infer<typeof JumiaProductsResponseSchema>;
export type JumiaProduct = z.infer<typeof JumiaProductSchema>;
export type JumiaVariation = z.infer<typeof JumiaVariationSchema>;
export type JumiaCategoriesResponse = z.infer<
  typeof JumiaCategoriesResponseSchema
>;
export type JumiaCategory = z.infer<typeof JumiaCategorySchema>;
export type JumiaBrand = z.infer<typeof JumiaBrandSchema>;
export type JumiaBrandsResponse = z.infer<typeof JumiaBrandsResponseSchema>;
export type JumiaAttributeSetResponse = z.infer<
  typeof JumiaAttributeSetResponseSchema
>;
export type JumiaStockResponse = z.infer<typeof JumiaStockResponseSchema>;
export type JumiaAttributeType = z.infer<typeof JumiaAttributeSchema>;
export type JumiaSalePriceType = z.infer<typeof JumiaSalePriceSchema>;
export type JumiaGlobalPriceType = z.infer<typeof JumiaGlobalPriceSchema>;
