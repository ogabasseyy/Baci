export function validateSetup(environment) {
  const names = [
    'ISOLATED_POSTGRES_PASSWORD',
    'ISOLATED_AUTH_DB_PASSWORD',
    'ISOLATED_REST_DB_PASSWORD',
    'ISOLATED_JWT_SECRET',
  ];
  const values = names.map((name) => environment[name]);
  if (
    values.some(
      (value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)
    )
  ) {
    throw new Error(
      'Four independent 64-character hexadecimal staging secrets required'
    );
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Staging secrets must all be distinct');
  }
  for (const name of Object.keys(environment)) {
    if (
      /^(PG|POSTGRES|SUPABASE|DATABASE|COMPOSE_|DOCKER_|GOTRUE_|PGRST_|SMTP_|PAYSTACK|PIGGYVEST)/.test(
        name
      )
    ) {
      throw new Error('Ambient infrastructure/provider variables forbidden');
    }
  }
  const origin = environment.ISOLATED_API_ORIGIN;
  if (
    typeof origin !== 'string' ||
    !/^https:\/\/staging-auth\.[a-z0-9.-]+$/.test(origin)
  ) {
    throw new Error('Explicit dedicated staging-auth HTTPS origin required');
  }
  if (
    new URL(origin).origin !== origin ||
    environment.ISOLATED_AUTH_ISSUER !== `${origin}/auth/v1`
  ) {
    throw new Error('Issuer must equal the staging API origin plus /auth/v1');
  }
  const site = environment.ISOLATED_SITE_URL;
  if (
    typeof site !== 'string' ||
    !/^https:\/\/staging\.[a-z0-9.-]+(?:\/[a-zA-Z0-9/_-]*)?$/.test(site)
  ) {
    throw new Error('Exact staging HTTPS redirect required');
  }
  if (environment.ISOLATED_PARENT_REVIEW !== 'private-services-reviewed') {
    throw new Error('Parent review and secret provenance validation required');
  }
}
