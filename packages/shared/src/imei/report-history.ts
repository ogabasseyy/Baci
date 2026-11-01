import { z } from 'zod';
import type { ImeiDeviceCategory } from './service-tier-types';
import {
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  isImeiServiceTierKey,
} from './service-tiers';

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
  deviceProfile: z
    .object({
      version: z.literal(1),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      color: z.string().nullable(),
      storage: z.string().nullable(),
      catalogProductId: z.string().optional(),
      imageMatch: z.enum(['color', 'model', 'none']),
    })
    .optional(),
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

export function resolveImeiReportDevice(
  tier: ImeiServiceTierKey,
  device: unknown
): ImeiDeviceCategory | null {
  const categories: readonly ImeiDeviceCategory[] =
    IMEI_SERVICE_TIERS[tier].deviceCategories;
  if (categories.some((category) => category === device))
    return device as ImeiDeviceCategory;
  return device == null && categories.length === 1 ? categories[0] : null;
}
export const ImeiReportSchema = z.object({
  lookupId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  tier: z
    .string()
    .refine((key): key is ImeiServiceTierKey => isImeiServiceTierKey(key)),
  device: z.enum(['smartphone', 'tablet', 'laptop', 'watch']).nullable(),
  result: ImeiResultSchema,
});
export type ImeiReport = z.infer<typeof ImeiReportSchema>;
export const ImeiReportsResponseSchema = z.object({
  reports: z.array(ImeiReportSchema).max(20),
  hasMore: z.boolean(),
});
export async function fetchImeiReports({
  apiBaseUrl = '',
  merchantSlug,
  accessToken,
  page = 0,
  signal,
  fetchImpl = fetch,
}: {
  apiBaseUrl?: string;
  merchantSlug?: string;
  accessToken?: string;
  page?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}) {
  const query = new URLSearchParams({ page: String(page) });
  if (merchantSlug) query.set('merchantSlug', merchantSlug);
  const response = await fetchImpl(
    `${apiBaseUrl.replace(/\/$/, '')}/api/storefront/imei-check/reports?${query}`,
    {
      method: 'GET',
      cache: 'no-store',
      signal,
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
    }
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Sign in to view your completed reports.'
        : 'Unable to load reports. Please try again.'
    );
  return ImeiReportsResponseSchema.parse(await response.json());
}
