import 'server-only';

export type OxygenEnvironment = 'staging' | 'production';
export const oxygenProviderOrigins = {
  staging: 'https://staging-api.theoxygen.com/services/partners',
  production: 'https://api.oxygenx.africa/services/partners',
} as const;

/** Deployment-controlled configuration only. Requests cannot choose origins or credentials. */
export function readOxygenRuntimeConfiguration() {
  const environment: OxygenEnvironment =
    process.env.VERCEL_ENV === 'production' ? 'production' : 'staging';
  if (
    environment === 'production' &&
    process.env.OXYGEN_PRODUCTION_RUNTIME_ENABLED !== 'true'
  )
    return null;
  const prefix =
    environment === 'production' ? 'OXYGEN_PRODUCTION' : 'OXYGEN_STAGING';
  const reference = process.env[`${prefix}_PARTNER_REFERENCE`];
  const secret = process.env[`${prefix}_PARTNER_SECRET`];
  const email = process.env[`${prefix}_WORKER_EMAIL`];
  const password = process.env[`${prefix}_WORKER_PASSWORD`];
  const rawHosts = process.env[`${prefix}_HOSTED_HOSTS`];
  const evidenceKey =
    process.env[
      environment === 'production'
        ? 'OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY'
        : 'OXYGEN_DRAFT_ENCRYPTION_KEY'
    ];
  if (
    !reference ||
    !secret ||
    !email ||
    !password ||
    !rawHosts ||
    !evidenceKey ||
    !/^[a-f0-9]{64}$/i.test(evidenceKey)
  )
    return null;
  const names = rawHosts
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (
    !names.length ||
    names.some((host) => {
      if (
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
        !host.includes('.') ||
        host.includes('..')
      )
        return true;
      try {
        return new URL(`https://${host}`).hostname !== host;
      } catch {
        return true;
      }
    })
  )
    return null;
  const hosts = new Set(names);
  if (environment === 'staging') hosts.add('payment.hydrogenpay.com');
  return {
    environment,
    baseUrl: oxygenProviderOrigins[environment],
    reference,
    secret,
    email,
    password,
    evidenceKey,
    hosts,
  };
}
