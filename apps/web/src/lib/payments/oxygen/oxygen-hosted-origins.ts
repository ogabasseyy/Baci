import { resolveOxygenEnvironment } from './environment';

let warnedSelfieHostMismatch = false;

/** Public browser origins only. This module never reads credentials or tokens. */
function parseHosts(raw: string | undefined): string[] | null {
  if (!raw) return [];
  const names = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!names.length) return [];
  if (
    names.some((name) => {
      if (
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) ||
        !name.includes('.') ||
        name.includes('..')
      )
        return true;
      try {
        return new URL(`https://${name}`).hostname !== name;
      } catch {
        return true;
      }
    })
  )
    return null;
  return [...new Set(names)];
}

/** Only explicitly configured, validated origins can be serialized or put in headers. */
export function readOxygenHostedOrigins(): {
  hosted: string[];
  selfie: string[];
} {
  const environment = resolveOxygenEnvironment();
  if (!environment) return { hosted: [], selfie: [] };
  const production = environment === 'production';
  if (production && process.env.OXYGEN_PRODUCTION_RUNTIME_ENABLED !== 'true')
    return { hosted: [], selfie: [] };
  const hostedNames = parseHosts(
    production
      ? process.env.OXYGEN_PRODUCTION_HOSTED_HOSTS
      : process.env.OXYGEN_STAGING_HOSTED_HOSTS
  );
  const selfieNames = parseHosts(
    production
      ? process.env.OXYGEN_PRODUCTION_SELFIE_HOSTS
      : process.env.OXYGEN_STAGING_SELFIE_HOSTS
  );
  if (!hostedNames || !selfieNames) return { hosted: [], selfie: [] };
  if (selfieNames.some((name) => !hostedNames.includes(name))) {
    if (!warnedSelfieHostMismatch) {
      console.error('oxygen_selfie_host_configuration_mismatch');
      warnedSelfieHostMismatch = true;
    }
  } else {
    warnedSelfieHostMismatch = false;
  }
  return {
    hosted: hostedNames.map((name) => `https://${name}`),
    selfie: selfieNames
      .filter((name) => hostedNames.includes(name))
      .map((name) => `https://${name}`),
  };
}
