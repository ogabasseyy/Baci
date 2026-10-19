/**
 * R1 read-only connector gateway configuration.
 *
 * Deployable staging gateway: unlike the R0 harness it does not refuse
 * every production-shaped environment, but production traffic still needs
 * the production-scope ADR-003 decision plus an explicit approval flag.
 * All values come from the environment; the public base address is
 * required and must be stable HTTPS (plain HTTP only for loopback).
 */

import { isIP } from 'node:net';

export interface GatewayConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** Local test-grant controls exist only outside production. */
  localGrantManagement: {
    ownerSecret: string;
    ownerUserId: string;
    merchantId: string;
  } | null;
  /** Stable public base address advertised in discovery documents. */
  publicBaseUrl: string;
  rateLimitPerKey: number;
  rateLimitPerIp: number;
  rateLimitWindowMs: number;
  /**
   * Socket peers allowed to supply X-Forwarded-For (default loopback:
   * the local path-filtering proxy). Forwarded addresses from any
   * other peer are ignored.
   */
  trustedProxies: string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function required(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`gateway_config_missing:${name}`);
  }
  return value;
}

function requiredUuid(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = required(env, name);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`gateway_config_invalid:${name}`);
  }
  return value;
}

function trustedProxyList(env: Record<string, string | undefined>): string[] {
  const raw = env.CONNECTOR_GATEWAY_TRUSTED_PROXIES?.trim();
  if (!raw) {
    return ['127.0.0.1', '::1'];
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_TRUSTED_PROXIES');
  }
  for (const entry of entries) {
    if (!isIP(entry)) {
      throw new Error(
        'gateway_config_invalid:CONNECTOR_GATEWAY_TRUSTED_PROXIES'
      );
    }
  }
  return [...new Set(entries)];
}

function optionalInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`gateway_config_invalid:${name}`);
  }
  return value;
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_PUBLIC_BASE_URL');
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.search !== ''
  ) {
    throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_PUBLIC_BASE_URL');
  }
  if (url.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        'gateway_config_invalid:CONNECTOR_GATEWAY_PUBLIC_BASE_URL'
      );
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_PUBLIC_BASE_URL');
  }
  return url.toString().replace(/\/+$/, '');
}

export function loadGatewayConfig(
  env: Record<string, string | undefined>
): GatewayConfig {
  const production = env.NODE_ENV === 'production';
  if (production) {
    if (env.CONNECTOR_GATEWAY_PRODUCTION_APPROVED !== '1') {
      throw new Error('gateway_production_not_approved');
    }
    if (
      [
        env.CONNECTOR_GATEWAY_OWNER_SECRET,
        env.CONNECTOR_GATEWAY_OWNER_USER_ID,
        env.CONNECTOR_GATEWAY_MERCHANT_ID,
      ].some((value) => value?.trim())
    ) {
      throw new Error('gateway_local_grant_management_forbidden_in_production');
    }
  }
  if (env.CONNECTOR_GATEWAY_ENABLED !== '1') {
    throw new Error('gateway_not_enabled');
  }

  const portRaw = env.CONNECTOR_GATEWAY_PORT?.trim() || '3201';
  const port = Number(portRaw);
  // Port 0 selects an ephemeral port (used by the runtime regression suite).
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_PORT');
  }

  let localGrantManagement: GatewayConfig['localGrantManagement'] = null;
  if (!production) {
    const ownerSecret = required(env, 'CONNECTOR_GATEWAY_OWNER_SECRET');
    if (ownerSecret.length < 32) {
      throw new Error('gateway_config_invalid:CONNECTOR_GATEWAY_OWNER_SECRET');
    }
    localGrantManagement = {
      ownerSecret,
      ownerUserId: requiredUuid(env, 'CONNECTOR_GATEWAY_OWNER_USER_ID'),
      merchantId: requiredUuid(env, 'CONNECTOR_GATEWAY_MERCHANT_ID'),
    };
  }

  return {
    host: env.CONNECTOR_GATEWAY_HOST?.trim() || '127.0.0.1',
    port,
    databaseUrl: required(env, 'CONNECTOR_GATEWAY_DATABASE_URL'),
    localGrantManagement,
    publicBaseUrl: normalizeBaseUrl(
      required(env, 'CONNECTOR_GATEWAY_PUBLIC_BASE_URL')
    ),
    rateLimitPerKey: optionalInt(
      env,
      'CONNECTOR_GATEWAY_RATE_PER_KEY',
      120,
      1,
      10_000
    ),
    rateLimitPerIp: optionalInt(
      env,
      'CONNECTOR_GATEWAY_RATE_PER_IP',
      600,
      1,
      100_000
    ),
    rateLimitWindowMs: optionalInt(
      env,
      'CONNECTOR_GATEWAY_RATE_WINDOW_MS',
      60_000,
      1_000,
      3_600_000
    ),
    trustedProxies: trustedProxyList(env),
  };
}
