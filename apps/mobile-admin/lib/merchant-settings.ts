import type {
  MerchantSettingsRecord,
  MerchantSettingsUpdatePayload,
} from '@baci/shared';
import { apiClient } from './api-client';
import { supabase } from './supabase';

interface MerchantSettingsResponse {
  merchant: MerchantSettingsRecord;
}

/**
 * Updates the explicitly selected merchant. The server authorizes this ID
 * against the authenticated user; it is an assertion, never authority.
 */
export function updateMerchantSettings(
  merchantId: string,
  payload: MerchantSettingsUpdatePayload
) {
  return apiClient<MerchantSettingsResponse>('/api/merchant/settings', {
    method: 'PATCH',
    body: JSON.stringify({ ...payload, merchantId }),
  });
}

export interface MerchantIdentitySettingsPayload {
  business_address?: string | null;
  business_name?: string | null;
  country?: string | null;
  payout_currency?: string | null;
  phone?: string | null;
  slug?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
}

type MerchantIdentitySettingsFormValues = {
  [Key in keyof MerchantIdentitySettingsPayload]-?: string;
};

export type MerchantIdentitySettingsReceipt = Readonly<{
  merchantId: string;
  savedValues: Readonly<MerchantIdentitySettingsFormValues>;
  updatedAt: string;
}>;

const merchantIdentitySettingKeys = [
  'business_address',
  'business_name',
  'country',
  'payout_currency',
  'phone',
  'slug',
  'support_email',
  'support_phone',
] as const satisfies readonly (keyof MerchantIdentitySettingsPayload)[];
const merchantIdentityReceiptKeys = new Set<string>([
  'id',
  'updated_at',
  ...merchantIdentitySettingKeys,
]);

function parseMerchantIdentitySettingsReceipt(
  value: unknown,
  expectedMerchantId: string
): MerchantIdentitySettingsReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid store settings update response');
  }
  const record = value as Record<string, unknown>;
  if (
    Array.from(merchantIdentityReceiptKeys).some(
      (key) => !Object.hasOwn(record, key)
    ) ||
    record.id !== expectedMerchantId ||
    typeof record.updated_at !== 'string' ||
    Number.isNaN(Date.parse(record.updated_at))
  ) {
    throw new Error('Invalid store settings update response');
  }

  const savedValues = {} as MerchantIdentitySettingsFormValues;
  for (const key of merchantIdentitySettingKeys) {
    const setting = record[key];
    if (setting !== null && typeof setting !== 'string') {
      throw new Error('Invalid store settings update response');
    }
    savedValues[key] = setting ?? '';
  }

  return Object.freeze({
    merchantId: expectedMerchantId,
    savedValues: Object.freeze(savedValues),
    updatedAt: record.updated_at,
  });
}

function merchantIdentityUpdateError(message: string): Error {
  if (message.includes('merchant_settings_mfa_required')) {
    return new Error(
      'Multi-factor authentication is required. Verify your second factor in Security, then try again.'
    );
  }

  if (message.includes('merchant_settings_reauthentication_required')) {
    return new Error(
      'For your security, sign out and sign back in before changing store contact details.'
    );
  }

  if (message.includes('invalid_support_phone')) {
    return new Error(
      'Enter the full phone number with its country code, for example +234 801 234 5678.'
    );
  }

  if (message.includes('merchant_settings_conflict')) {
    return new Error(
      'These settings changed elsewhere. Reopen the page and try again.'
    );
  }

  return new Error(message || 'Failed to update store settings');
}

export async function updateMerchantIdentitySettings(params: {
  expectedUpdatedAt: string;
  merchantId: string;
  settings: MerchantIdentitySettingsPayload;
}): Promise<MerchantIdentitySettingsReceipt> {
  const { data, error } = await supabase.rpc(
    'update_merchant_identity_settings',
    {
      p_expected_updated_at: params.expectedUpdatedAt,
      p_merchant_id: params.merchantId,
      p_settings: params.settings,
    }
  );

  if (error) {
    throw merchantIdentityUpdateError(error.message);
  }
  return parseMerchantIdentitySettingsReceipt(data, params.merchantId);
}
