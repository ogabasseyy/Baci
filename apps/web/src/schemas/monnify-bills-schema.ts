import { z } from 'zod';

export const validateCustomerRequestSchema = z.object({
  productCode: z.string().min(1, 'Product code is required'),
  customerId: z.string().min(1, 'Customer identifier is required'),
});

export type ValidateCustomerRequest = z.infer<
  typeof validateCustomerRequestSchema
>;

export const vendRequestSchema = z.object({
  productCode: z.string().min(1, 'Product code is required'),
  amount: z.number().positive('Vend amount must be positive'),
  vendAmount: z.number().positive('Vend amount must be positive'),
  customerId: z.string().min(1, 'Customer identifier is required'),
  vendReference: z.string().min(1, 'Vend reference is required'),
  validationReference: z.string().optional(),
});

export type VendRequest = z.infer<typeof vendRequestSchema>;

const monnifyResponseCodeSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

const monnifyOptionalNumberSchema = z
  .union([
    z.number().finite(),
    z
      .string()
      .trim()
      .min(1)
      .transform((value, ctx) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Expected a finite number',
          });
          return z.NEVER;
        }
        return numeric;
      }),
  ])
  .optional()
  .nullable();

const monnifyOptionalBooleanSchema = z
  .union([
    z.boolean(),
    z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(['true', 'false']).transform((value) => value === 'true')),
  ])
  .optional()
  .nullable();

// Generic Monnify API Envelope Schema
export function monnifyEnvelopeSchema<T extends z.ZodTypeAny>(bodySchema: T) {
  return z.object({
    requestSuccessful: z.boolean(),
    responseCode: monnifyResponseCodeSchema,
    responseMessage: z.string(),
    responseBody: bodySchema.optional().nullable(),
  });
}

// Biller Category Schema
export const billerCategorySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  code: z.string(),
});
export type BillerCategory = z.infer<typeof billerCategorySchema>;

// Biller Schema
const monnifyCategoryRefSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const billerSchema = z
  .union([
    z.object({
      name: z.string(),
      description: z.string().optional(),
      billerCode: z.string(),
      billerCategoryCode: z.string(),
      categoryCodes: z.array(z.string()).optional(),
    }),
    z.object({
      code: z.string(),
      name: z.string(),
      categories: z
        .array(monnifyCategoryRefSchema)
        .min(1, 'At least one Monnify category is required'),
    }),
  ])
  .transform((biller) => {
    if ('billerCode' in biller) {
      return {
        name: biller.name,
        description: biller.description ?? biller.name,
        billerCode: biller.billerCode,
        billerCategoryCode: biller.billerCategoryCode,
        categoryCodes:
          biller.categoryCodes ??
          (biller.billerCategoryCode ? [biller.billerCategoryCode] : []),
      };
    }

    const categoryCodes =
      biller.categories?.map((category) => category.code) ?? [];
    return {
      name: biller.name,
      description: biller.name,
      billerCode: biller.code,
      billerCategoryCode: categoryCodes[0] ?? '',
      categoryCodes,
    };
  });
export type Biller = z.infer<typeof billerSchema>;

// Biller Product Schema
export const billerProductSchema = z
  .union([
    z.object({
      productCode: z.string(),
      name: z.string(),
      billerCode: z.string(),
      fee: monnifyOptionalNumberSchema,
      amount: monnifyOptionalNumberSchema,
      isAmountFixed: monnifyOptionalBooleanSchema,
      categoryCode: z.string().optional(),
      minAmount: monnifyOptionalNumberSchema,
      maxAmount: monnifyOptionalNumberSchema,
    }),
    z.object({
      code: z.string(),
      name: z.string(),
      category: monnifyCategoryRefSchema.optional().nullable(),
      biller: monnifyCategoryRefSchema.optional().nullable(),
      minAmount: monnifyOptionalNumberSchema,
      maxAmount: monnifyOptionalNumberSchema,
      price: monnifyOptionalNumberSchema,
      priceType: z.string().optional().nullable(),
    }),
  ])
  .transform((product) => {
    if ('productCode' in product) {
      return {
        productCode: product.productCode,
        name: product.name,
        billerCode: product.billerCode,
        fee: product.fee ?? null,
        amount: product.amount ?? null,
        isAmountFixed: product.isAmountFixed ?? null,
        categoryCode: product.categoryCode,
        minAmount: product.minAmount ?? null,
        maxAmount: product.maxAmount ?? null,
      };
    }

    const isAmountFixed = product.priceType?.toUpperCase() === 'FIXED';
    return {
      productCode: product.code,
      name: product.name,
      // Current Monnify product-list responses can omit the nested biller;
      // callers fetch by billerCode and treat an empty product billerCode as
      // matching that queried biller before charging.
      billerCode: product.biller?.code ?? '',
      fee: null,
      amount: product.price ?? null,
      isAmountFixed,
      categoryCode: product.category?.code,
      minAmount: product.minAmount ?? null,
      maxAmount: product.maxAmount ?? null,
    };
  });
export type BillerProduct = z.infer<typeof billerProductSchema>;

export function monnifyListResponseBodySchema<T extends z.ZodTypeAny>(
  itemSchema: T
) {
  return z.union([
    z.array(itemSchema),
    z
      .object({
        content: z.array(itemSchema),
      })
      .transform((body) => body.content),
  ]);
}

// Validate Customer Response Body Schema (flat + nested vendInstruction support)
export const validateCustomerResponseBodySchema = z.object({
  customerName: z.string().optional().nullable(),
  // Meter/customer address (e.g. EKEDC prepaid) — surfaced for the receipt.
  address: z.string().optional().nullable(),
  validationReference: z.string().optional().nullable(),
  requireValidationRef: z.boolean().optional().nullable(),
  vendInstruction: z
    .object({
      validationReference: z.string().optional().nullable(),
      requireValidationRef: z.boolean().optional().nullable(),
    })
    .optional()
    .nullable(),
});
export type ValidateCustomerResponseBody = z.infer<
  typeof validateCustomerResponseBodySchema
>;

// Monnify returns the delivered token/units NESTED under responseBody.metaData
// for token-bearing bills (e.g. prepaid electricity):
//   responseBody.metaData = { token: "3772-...-0336", unit: "4.5" }
// A flat `token` is kept as a fallback in case other billers return it top-level.
const billMetaDataSchema = z
  .object({
    token: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
  })
  .optional()
  .nullable();

// A vend state some Monnify answers carry as `transactionStatus` (string or
// number). It is read as the vend state when `vendStatus` is absent.
const transactionStatusSchema = z
  .union([z.string(), z.number().transform(String)])
  .optional()
  .nullable();

// Vend Response Body Schema
export const vendResponseBodySchema = z.object({
  transactionReference: z.string().optional().nullable(),
  // Monnify's own vend reference (MFBP-MDR-<customer>-…). This — NOT
  // transactionReference — is what the requery endpoint resolves by.
  vendReference: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  vendStatus: transactionStatusSchema,
  transactionStatus: transactionStatusSchema,
  finalStatus: transactionStatusSchema,
  token: z.string().optional().nullable(),
  metaData: billMetaDataSchema,
});
export type VendResponseBody = z.infer<typeof vendResponseBodySchema>;

// Requery Response Body Schema
export const requeryResponseBodySchema = z.object({
  transactionReference: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  vendStatus: transactionStatusSchema,
  transactionStatus: transactionStatusSchema,
  finalStatus: transactionStatusSchema,
  token: z.string().optional().nullable(),
  metaData: billMetaDataSchema,
});
export type RequeryResponseBody = z.infer<typeof requeryResponseBodySchema>;
