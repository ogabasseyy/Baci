// Namespace import as a value (not type-only) because we use
// `crypto.createPrivateKey` at runtime and `crypto.KeyObject` as a type.
import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import 'server-only';
import type { z } from 'zod';
import {
  getSupabaseAgenticJwtPrivateJwk,
  getSupabaseAnonKey,
  getSupabaseJwtSecret,
  getSupabaseLegacyAnonJwt,
} from '@/env';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { supabaseAgenticJwtPrivateJwkSchema } from '@/schemas/supabase-agentic-jwt-private-jwk';

export type AgenticJwtSigningMaterial =
  | { secret: string; type: 'legacy-secret' }
  | {
      jwk: SupabaseAgenticPrivateJwk;
      keyObject: crypto.KeyObject;
      type: 'private-jwk';
    };

export type SupabaseAgenticPrivateJwk = z.infer<
  typeof supabaseAgenticJwtPrivateJwkSchema
>;

let cachedPrivateJwkRaw: string | null = null;
const INVALID_PRIVATE_JWK_MATERIAL = Symbol('invalid-private-jwk-material');

type CachedPrivateJwkMaterial =
  | Extract<AgenticJwtSigningMaterial, { type: 'private-jwk' }>
  | typeof INVALID_PRIVATE_JWK_MATERIAL
  | null;

let cachedPrivateJwkMaterial: CachedPrivateJwkMaterial = null;

const PRODUCTION_SIGNING_MATERIAL_ERROR =
  'SUPABASE_AGENTIC_JWT_PRIVATE_JWK is required in production when the legacy Supabase JWT secret cannot be verified';

export function getAgenticJwtSigningMaterial(): AgenticJwtSigningMaterial {
  const privateJwk = getSupabaseAgenticJwtPrivateJwk();
  if (privateJwk) {
    if (cachedPrivateJwkRaw === privateJwk) {
      if (cachedPrivateJwkMaterial === INVALID_PRIVATE_JWK_MATERIAL) {
        if (isProductionRuntime()) {
          throw new Error(PRODUCTION_SIGNING_MATERIAL_ERROR);
        }
        return { secret: getSupabaseJwtSecret(), type: 'legacy-secret' };
      }

      if (cachedPrivateJwkMaterial) {
        return cachedPrivateJwkMaterial;
      }
    }

    try {
      // Process-scoped cache. Key rotation is picked up when the raw env value changes
      // via redeploy or runtime env refresh.
      const jwk = parseSupabaseAgenticPrivateJwk(privateJwk);
      // Cast the full input object so we don't have to name the inner `key`
      // type, which differs between hoisted @types/node versions.
      const keyInput = {
        format: 'jwk',
        key: jwk,
      } as unknown as Parameters<typeof crypto.createPrivateKey>[0];
      cachedPrivateJwkMaterial = {
        jwk,
        keyObject: crypto.createPrivateKey(keyInput),
        type: 'private-jwk',
      };
      cachedPrivateJwkRaw = privateJwk;

      return cachedPrivateJwkMaterial;
    } catch (error) {
      cachedPrivateJwkMaterial = INVALID_PRIVATE_JWK_MATERIAL;
      cachedPrivateJwkRaw = privateJwk;
      logger.warn({
        error: sanitizeForLog(
          error instanceof Error
            ? { message: error.message, name: error.name }
            : error
        ),
        message: isProductionRuntime()
          ? 'Agentic JWT private JWK is invalid in production'
          : 'Agentic JWT private JWK is invalid; falling back to legacy JWT secret',
      });
      if (isProductionRuntime()) {
        throw new Error(PRODUCTION_SIGNING_MATERIAL_ERROR);
      }
    }
  }

  const legacySecret = getSupabaseJwtSecret();
  if (isProductionRuntime() && !isLegacySupabaseJwtSecret(legacySecret)) {
    throw new Error(PRODUCTION_SIGNING_MATERIAL_ERROR);
  }

  return { secret: legacySecret, type: 'legacy-secret' };
}

export function hasUsableAgenticJwtSigningMaterial(): boolean {
  try {
    getAgenticJwtSigningMaterial();
    return true;
  } catch (error) {
    logger.warn({
      error: sanitizeForLog(
        error instanceof Error
          ? { message: error.message, name: error.name }
          : error
      ),
      message: 'Agentic JWT signing material is unavailable',
    });
    return false;
  }
}

function parseSupabaseAgenticPrivateJwk(
  rawPrivateJwk: string
): SupabaseAgenticPrivateJwk {
  return supabaseAgenticJwtPrivateJwkSchema.parse(rawPrivateJwk);
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * A non-empty legacy env value can be a signing-key id or another stale
 * placeholder. Verify it against the configured legacy anon key before using
 * it, otherwise the generated capability will be rejected as PGRST301.
 */
function isLegacySupabaseJwtSecret(secret: string): boolean {
  if (typeof secret !== 'string' || secret.length === 0) {
    return false;
  }

  let anonKey: string;
  try {
    anonKey = (getSupabaseLegacyAnonJwt() ?? getSupabaseAnonKey()).trim();
  } catch {
    return false;
  }

  const parts = anonKey.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return false;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: unknown;
  try {
    header = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8')
    );
  } catch {
    return false;
  }

  if (
    typeof header !== 'object' ||
    header === null ||
    !('alg' in header) ||
    header.alg !== 'HS256'
  ) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = Buffer.from(encodedSignature, 'base64url');

  return (
    actualSignature.length === expectedSignature.length &&
    crypto.timingSafeEqual(actualSignature, expectedSignature)
  );
}
