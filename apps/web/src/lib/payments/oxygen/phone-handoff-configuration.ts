import 'server-only';
import { resolveOxygenEnvironment } from './environment';
import { readOxygenHostedOrigins } from './oxygen-hosted-origins';
import type { OxygenEnvironment } from './runtime-configuration';

export interface OxygenPhoneConfiguration {
  environment: OxygenEnvironment;
  origin: string;
  key: string;
  hosts: ReadonlySet<string>;
}
/** Operator-controlled origin and exact selfie hosts. Never derive the destination from Host. */
export function oxygenPhoneConfiguration(
  environment: OxygenEnvironment,
  key: string
): OxygenPhoneConfiguration | null {
  const prefix =
    environment === 'production' ? 'OXYGEN_PRODUCTION' : 'OXYGEN_STAGING';
  const origin = process.env[`${prefix}_HANDOFF_ORIGIN`];
  const selfieOrigins = readOxygenHostedOrigins().selfie;
  if (
    process.env[`${prefix}_DURABLE_HANDOFF_ENABLED`] !== 'true' ||
    !origin ||
    resolveOxygenEnvironment() !== environment ||
    !selfieOrigins.length ||
    !/^[a-f0-9]{64}$/i.test(key)
  )
    return null;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    return {
      environment,
      origin,
      key,
      hosts: new Set(selfieOrigins.map((value) => new URL(value).hostname)),
    };
  } catch {
    return null;
  }
}
