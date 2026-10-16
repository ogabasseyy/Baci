import Constants from 'expo-constants';
import { z } from 'zod';

// Native callers use the programmatic api.* origin: it is the only
// production surface that returns the script/device-readable cart
// bootstrap proof the native client requires.
const DEFAULT_MOBILE_API_URL = 'https://api.usebaci.com';

function emptyStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0
    ? undefined
    : value;
}

export const MobileEnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().url().optional().default(DEFAULT_MOBILE_API_URL)
  ),
  // Platform root the merchant storefront subdomains live under
  // (mirrors the web NEXT_PUBLIC_ROOT_DOMAIN); pairing links are
  // minted on <slug>.<root>, so the allowlist needs the exact value.
  EXPO_PUBLIC_ROOT_DOMAIN: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().optional()
  ),
});

export type MobileEnv = z.infer<typeof MobileEnvSchema>;

function formatEnvError(error: z.ZodError<MobileEnv>) {
  return error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

export function parseMobileEnv(rawEnv: unknown): MobileEnv {
  const result = MobileEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    throw new Error(
      `Invalid mobile environment configuration (${formatEnvError(result.error)}).`
    );
  }
  return result.data;
}

function readExpoExtraApiUrl() {
  return typeof Constants.expoConfig?.extra?.apiUrl === 'string'
    ? Constants.expoConfig.extra.apiUrl
    : undefined;
}

function readPublicApiUrl() {
  return process.env.EXPO_PUBLIC_API_URL;
}

function readRootDomain() {
  return (
    process.env.EXPO_PUBLIC_ROOT_DOMAIN ??
    (typeof Constants.expoConfig?.extra?.rootDomain === 'string'
      ? Constants.expoConfig.extra.rootDomain
      : undefined)
  );
}

const rawEnv = {
  EXPO_PUBLIC_API_URL: readPublicApiUrl() ?? readExpoExtraApiUrl(),
  EXPO_PUBLIC_ROOT_DOMAIN: readRootDomain(),
};

let parsedEnv: MobileEnv;
try {
  parsedEnv = parseMobileEnv(rawEnv);
} catch (error) {
  const message =
    error instanceof Error
      ? error.message.replace(/\.$/, '')
      : 'Invalid mobile environment configuration';
  throw new Error(
    `${message}. ` +
      `Received EXPO_PUBLIC_API_URL=${JSON.stringify(rawEnv.EXPO_PUBLIC_API_URL)}.`
  );
}

export const { EXPO_PUBLIC_API_URL, EXPO_PUBLIC_ROOT_DOMAIN } = parsedEnv;
