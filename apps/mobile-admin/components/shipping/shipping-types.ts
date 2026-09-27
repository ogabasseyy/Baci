import {
  CARRIER_PROVIDER_IDS,
  type CarrierProviderId,
  normalizeCarrierProviderIds,
} from '@baci/shared';
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { z } from 'zod';

const shippingProviderIdSchema = z.enum(CARRIER_PROVIDER_IDS);

export const AVAILABLE_PROVIDERS = [
  {
    id: 'gigl',
    name: 'GIG Logistics',
    description: 'Nationwide delivery with tracking',
    icon: 'cube-outline',
  },
  {
    id: 'topship',
    name: 'Topship',
    description: 'Fast local and international shipping',
    icon: 'airplane-outline',
  },
] as const satisfies readonly {
  id: CarrierProviderId;
  name: string;
  description: string;
  icon: IoniconsIconName;
}[];

export const shippingSettingsSchema = z.object({
  merchant_id: z.string().min(1),
  shipping_providers: z
    .array(shippingProviderIdSchema)
    .max(CARRIER_PROVIDER_IDS.length)
    .refine(
      (providers) => new Set(providers).size === providers.length,
      'Shipping providers must be unique'
    ),
  free_shipping_threshold: z.number().nullable(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseShippingSettings(data: unknown) {
  const normalized = isRecord(data)
    ? {
        ...data,
        shipping_providers: normalizeCarrierProviderIds(
          data.shipping_providers
        ),
      }
    : data;
  const parsed = shippingSettingsSchema.safeParse(normalized);
  if (!parsed.success) {
    console.error(
      '[ShippingSettings] Invalid settings payload',
      parsed.error.flatten()
    );
    throw new Error('Invalid shipping settings payload');
  }

  return parsed.data;
}

export type ProviderId = CarrierProviderId;
export type ShippingProvider = (typeof AVAILABLE_PROVIDERS)[number];

export type ShippingSettings = z.infer<typeof shippingSettingsSchema>;
