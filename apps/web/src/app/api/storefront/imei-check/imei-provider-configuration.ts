import 'server-only';
import { normalizeEnvBoolean } from '@/lib/env-boolean';

// Reads the IMEI provider settings straight from the server environment so the
// IMEI API files do not import the credential authority (`@/env`). The values
// and trimming rules match the getters in `@/env`.
const read = (name: string): string => process.env[name]?.trim() ?? '';

const readList = (name: string): string[] => {
  const raw = read(name);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
};

const normalizePetrockBaseUrl = (value: string): string => {
  const baseUrl = value.replace(/\/+$/, '');
  try {
    const parsed = new URL(baseUrl);
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.origin}/api/reseller/v1`;
    }
  } catch {
    return baseUrl;
  }
  return baseUrl;
};

const readBoolean = (name: string): boolean =>
  normalizeEnvBoolean(read(name)) ?? false;

export const getImeiHashSalt = () => read('IMEI_HASH_SALT') || undefined;

/** The provider settings prepareImeiProvider reads (one copy, shared). */
export const imeiProviderConfiguration = {
  getImeiDisabledTierKeys: () => readList('IMEI_DISABLED_TIERS'),
  getImeiIdentifierEncryptionKey: () =>
    read('IMEI_IDENTIFIER_ENCRYPTION_KEY') || undefined,
  getPetrockConfig: () => {
    const token = read('PETROCK_API_TOKEN');
    if (!token) return null;
    const baseUrl = normalizePetrockBaseUrl(
      read('PETROCK_API_BASE_URL') || 'https://api.petrock.biz/api/reseller/v1'
    );
    return { baseUrl, token };
  },
  getPetrockEnabledTierKeys: () => readList('PETROCK_ENABLED_TIERS'),
  getSickwApiKey: () => read('SICKW_API_KEY') || undefined,
  isPetrockEnabled: () => readBoolean('PETROCK_ENABLED'),
};
