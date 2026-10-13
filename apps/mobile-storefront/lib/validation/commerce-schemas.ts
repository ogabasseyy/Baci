import { z } from 'zod';
import { NigerianPhoneSchema } from './auth-schemas';

export const ShippingAddressSchema = z.object({
  email: z
    .string()
    .min(1, 'Email address is required')
    .email('Please enter a valid email address')
    .max(255, 'Email is too long'),
  firstName: z
    .string()
    .trim()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name is too long (max 50 characters)')
    .refine((value) => !/\d/.test(value), {
      message: 'First name cannot contain numbers',
    }),
  lastName: z
    .string()
    .trim()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name is too long (max 50 characters)')
    .refine((value) => !/\d/.test(value), {
      message: 'Last name cannot contain numbers',
    }),
  phone: NigerianPhoneSchema,
  address: z
    .string()
    .trim()
    .min(5, 'Please provide a more detailed address')
    .max(255, 'Address is too long (max 255 characters)'),
  city: z
    .string()
    .trim()
    .min(2, 'City name must be at least 2 characters')
    .max(100, 'City name is too long (max 100 characters)'),
  state: z.string().min(1, 'Please select your state'),
  notes: z
    .string()
    .max(500, 'Delivery notes are too long (max 500 characters)')
    .optional(),
});

export const CheckoutContactSchema = ShippingAddressSchema.pick({
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
});

export type ShippingAddressInput = z.infer<typeof ShippingAddressSchema>;

type SchemaSafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError<T> };

export const QuantitySchema = z
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(99, 'Maximum quantity is 99');

export function isValidIMEI(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = Number.parseInt(imei[i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateWithSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
):
  | { success: true; data: T }
  | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  result.error.issues.forEach((issue) => {
    const path = issue.path.join('.');
    if (!errors[path]) {
      errors[path] = issue.message;
    }
  });

  return { success: false, errors };
}

export function getFirstError<T>(
  result: SchemaSafeParseResult<T>
): string | null {
  if (result.success) return null;
  return result.error.issues[0]?.message || 'Validation failed';
}

export const CalculateOrderInput = z.object({
  subtotal: z.number().positive(),
  shippingFee: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  assuranceFee: z.number().min(0).optional(),
});

export const CalculateOrderOutput = z.object({
  taxAmount: z.number(),
  total: z.number(),
});

export const CalculateVTUInput = z.object({
  amount: z.number().positive(),
  provider: z.string().min(1, 'Provider is required'),
  category: z
    .enum(['AIRTIME', 'DATA', 'ELECTRICITY', 'CABLE', 'BETTING'])
    .optional(),
  merchantSplit: z.number().min(0).max(100).optional(),
});

export const CalculateVTUOutput = z.object({
  platformEarning: z.number(),
  merchantEarning: z.number(),
  totalCommission: z.number(),
  commissionRate: z.number(),
});

export const RedeemLoyaltyInput = z.object({
  points: z.number().int().positive(),
  currentPoints: z.number().int().min(0),
  pointsToNairaRate: z.number().positive().optional(),
});

export const RedeemLoyaltyOutput = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  pointsRedeemed: z.number().optional(),
  walletCredit: z.number().optional(),
  remainingPoints: z.number().optional(),
  conversionRate: z.number().optional(),
  minRedeemPoints: z.number().optional(),
});

export type CalculateOrderInputType = z.infer<typeof CalculateOrderInput>;
export type CalculateOrderOutputType = z.infer<typeof CalculateOrderOutput>;
export type CalculateVTUInputType = z.infer<typeof CalculateVTUInput>;
export type CalculateVTUOutputType = z.infer<typeof CalculateVTUOutput>;
export type RedeemLoyaltyInputType = z.infer<typeof RedeemLoyaltyInput>;
export type RedeemLoyaltyOutputType = z.infer<typeof RedeemLoyaltyOutput>;

export const ReviewSchema = z.object({
  id: z.string(),
  rating: z.number().min(1).max(5),
  title: z.string().optional(),
  body: z.string().optional(),
  customer_name: z.string(),
  verified_purchase: z.boolean(),
  helpful_count: z.number().default(0),
  created_at: z.string(),
});

export const ReviewStatsSchema = z.object({
  average_rating: z.number().nullable(),
  review_count: z.number(),
  rating_distribution: z.record(z.string(), z.number()),
});

export const ReviewsApiResponseSchema = z.object({
  reviews: z.array(ReviewSchema).default([]),
  stats: ReviewStatsSchema.optional(),
  pagination: z
    .object({
      page: z.number(),
      limit: z.number(),
      totalPages: z.number(),
      totalCount: z.number().optional(),
    })
    .optional(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type ReviewStats = z.infer<typeof ReviewStatsSchema>;
export type ReviewsApiResponse = z.infer<typeof ReviewsApiResponseSchema>;

export const MarkReviewHelpfulResponseSchema = z.object({
  success: z.boolean(),
  helpfulCount: z.number(),
});

export type MarkReviewHelpfulResponse = z.infer<
  typeof MarkReviewHelpfulResponseSchema
>;

export const ImeiResultSchema = z.object({
  imei: z.string().min(1),
  device: z.string().min(1),
  modelNumber: z.string(),
  status: z.enum(['Clean', 'Blacklisted', 'Unknown']),
  icloud: z.string().min(1),
  icloudLock: z.string().min(1),
  simLock: z.string().min(1),
  blacklistStatus: z.string().min(1),
  carrier: z.string().min(1),
  deviceImage: z.string(),
  score: z.number(),
  activationStatus: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().min(1).optional(),
  purchaseCountry: z.string().optional(),
  warranty: z.string().optional(),
  refurbished: z.string().optional(),
  demoUnit: z.string().optional(),
  mdmStatus: z.string().optional(),
  knoxGuardStatus: z.string().optional(),
  miLockStatus: z.string().optional(),
  miLostStatus: z.string().optional(),
  partNumber: z.string().optional(),
  repairEligibility: z.string().optional(),
  gsxCoverage: z.string().optional(),
  repairHistory: z.string().optional(),
  replacementHistory: z.string().optional(),
  esimCompatibility: z.string().optional(),
  financeStatus: z.string().optional(),
  knoxEnrollment: z.string().optional(),
  soldBy: z.string().optional(),
  wifiMac: z.string().optional(),
  devicePhoto: z.string().optional(),
  deviceType: z.enum(['apple', 'android', 'other']),
  verdict: z.string().min(1),
  verdictType: z.enum(['safe', 'caution', 'danger']),
});

export const ImeiCheckApiResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(['complete', 'error', 'pending']).optional(),
  data: ImeiResultSchema.optional(),
  error: z.string().optional(),
  lookupId: z.string().uuid().optional(),
  pollAfterMs: z.number().int().positive().optional(),
});

export type ImeiResult = z.infer<typeof ImeiResultSchema>;
export type ImeiCheckApiResponse = z.infer<typeof ImeiCheckApiResponseSchema>;

export const AIAnalysisResultSchema = z.object({
  model: z.string(),
  grade: z.enum(['Excellent', 'Good', 'Fair', 'Poor']),
  observations: z.array(z.string()),
  basePrice: z.number(),
  estimatedValue: z.number(),
  deductionPercent: z.number(),
});

export const AIGradeDeviceApiResponseSchema = z.object({
  success: z.boolean(),
  data: AIAnalysisResultSchema.optional(),
  error: z.string().optional(),
});

export type AIAnalysisResult = z.infer<typeof AIAnalysisResultSchema>;
export type AIGradeDeviceApiResponse = z.infer<
  typeof AIGradeDeviceApiResponseSchema
>;

export const NegotiationResultSchema = z.object({
  status: z.enum(['accepted', 'counter', 'rejected', 'final']),
  counterOffer: z.number().optional(),
  originalPrice: z.number(),
  offeredPrice: z.number(),
  message: z.string(),
  attemptNumber: z.number(),
  canContinue: z.boolean(),
});

export type NegotiationResult = z.infer<typeof NegotiationResultSchema>;
