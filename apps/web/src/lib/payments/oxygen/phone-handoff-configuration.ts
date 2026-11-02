import 'server-only';
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
  const names = process.env[`${prefix}_SELFIE_HOSTS`]
    ?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    process.env[`${prefix}_DURABLE_HANDOFF_ENABLED`] !== 'true' ||
    !origin ||
    !names?.length ||
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
    if (
      names.some(
        (name) =>
          !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) ||
          !name.includes('.') ||
          name.includes('..') ||
          new URL(`https://${name}`).hostname !== name
      )
    )
      return null;
    return { environment, origin, key, hosts: new Set(names) };
  } catch {
    return null;
  }
}
