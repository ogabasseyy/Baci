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
  language: z.string().optional(),
  value: z.string().optional(),
});

export const JumiaAttributeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  value: z.string(),
  translations: z.array(JumiaTranslation).optional(),
});

export const JumiaSalePriceSchema = z.object({
  value: z.number().nonnegative(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
});

export const JumiaGlobalPriceSchema = z
  .object({
    currency: z.string().nullable().optional(),
    value: z.number().nonnegative().nullable().optional(),
    salePrice: JumiaSalePriceSchema.nullable().optional(),
  })
  .passthrough();

// Retrieve Products uses string codes, unlike the brands/categories endpoints.
const JumiaProductCodeSchema = z.object({ code: z.string(), name: z.string() });
const JumiaBusinessClientSchema = z
  .object({
    code: z.string().min(1),
    name: z.string(),
    countryName: z.string(),
    countryCode: z.string(),
    sku: z.string().nullable(),
    visible: z.boolean(),
    visibleUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']),
    qc: z
      .object({
        status: z.string(),
        updatedAt: z.iso.datetime({ offset: true }),
        lastApprovedAt: z.iso.datetime({ offset: true }),
        rejectionReason: z.string().optional(),
        rejectionComment: z.string().optional(),
      })
      .passthrough(),
    price: JumiaGlobalPriceSchema.extend({
      localCurrency: z.string().nullable().optional(),
      localValue: z.number().nonnegative().nullable().optional(),
      salePrice: JumiaSalePriceSchema.extend({
        localValue: z.number().nonnegative().optional(),
      })
        .nullable()
        .optional(),
    }),
  })
  .passthrough();

export const JumiaVariationSchema = z
  .object({
    id: z.uuid(),
    sellerSku: z.string().min(1),
    barcodeEan: z.string().nullable(),
    variation: z.string(),
    globalPrice: JumiaGlobalPriceSchema,
    attributes: z.array(JumiaAttributeSchema.partial({ value: true })),
    businessClients: z.array(JumiaBusinessClientSchema),
  })
  .passthrough();

export const JumiaProductSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string(),
    parentSku: z.string().min(1),
    shop: z.object({ id: z.uuid() }),
    brand: JumiaProductCodeSchema,
    category: JumiaProductCodeSchema,
    additionalCategories: z.array(JumiaProductCodeSchema).optional(),
    images: z.array(
      z.object({
        url: z.url(),
        originalUrl: z.url(),
        primary: z.boolean(),
      })
    ),
    attributeSetId: z.uuid(),
    attributes: z.array(JumiaAttributeSchema),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    variations: z.array(JumiaVariationSchema),
  })
  .passthrough();

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
