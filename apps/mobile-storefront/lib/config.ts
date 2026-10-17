import Constants from 'expo-constants';

/**
 * App Configuration
 * This is a dynamic merchant storefront app.
 * Identity is injected during build via app.config.js
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function readExpoExtra(): Record<string, unknown> {
  const constantsRecord = Constants as unknown as Record<string, unknown>;

  const expoConfig = asRecord(constantsRecord.expoConfig);
  const expoConfigExtra = asRecord(expoConfig?.extra);
  if (expoConfigExtra) return expoConfigExtra;

  const manifest = asRecord(constantsRecord.manifest);
  const manifestExtra = asRecord(manifest?.extra);
  if (manifestExtra) return manifestExtra;

  const manifest2 = asRecord(constantsRecord.manifest2);
  const manifest2Extra = asRecord(manifest2?.extra);
  const expoClient = asRecord(manifest2Extra?.expoClient);
  const expoClientExtra = asRecord(expoClient?.extra);
  if (expoClientExtra) return expoClientExtra;

  return {};
}

function readString(
  extra: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = extra[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback;
}

function readBoolean(
  extra: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = extra[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

const extra = readExpoExtra();

export const CONFIG = {
  MERCHANT_ID: readString(extra, 'merchantId', ''),
  // Keep mobile runtime fallback aligned with this app's default merchant.
  MERCHANT_SLUG: readString(extra, 'merchantSlug', 'ogabassey'),
  TEMPLATE_ID: readString(extra, 'templateId', 'default'),
  BUSINESS_TYPE: readString(extra, 'businessType', 'electronics'), // New: Business category
  // Smart Cart Pro gate, mirroring web's enableSmartCartPro prop. Default-on
  // for this Ogabassey app build; set extra.enableSmartCartPro=false to
  // make assurance opt-in without a code change.
  ENABLE_SMART_CART_PRO: readBoolean(extra, 'enableSmartCartPro', true),
} as const;
