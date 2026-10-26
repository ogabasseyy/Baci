import 'server-only';

export function isPrimaryProductionHost(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const host = env.PIGGYVEST_PRIMARY_EXECUTION_HOST;
  if (host === undefined || host === 'vercel') {
    return env.VERCEL_ENV === 'production';
  }
  return (
    host === 'vps' &&
    env.VERCEL_ENV === undefined &&
    env.NODE_ENV === 'production' &&
    env.PIGGYVEST_PRIMARY_ENVIRONMENT === 'production'
  );
}
