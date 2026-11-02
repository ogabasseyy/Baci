/** Resolve the provider environment from deployment configuration, never a request. */
export type OxygenEnvironment = 'staging' | 'production';
export function resolveOxygenEnvironment(): OxygenEnvironment | null {
  const deployment = process.env.VERCEL_ENV;
  const explicit = process.env.OXYGEN_ENVIRONMENT;
  if (explicit && explicit !== 'staging' && explicit !== 'production')
    return null;
  if (deployment === 'production')
    return explicit && explicit !== 'production' ? null : 'production';
  if (deployment === 'preview' || deployment === 'development')
    return explicit && explicit !== 'staging' ? null : 'staging';
  if (deployment) return null;
  if (explicit === 'staging') return 'staging';
  if (explicit === 'production') return null;
  return process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
    ? 'staging'
    : null;
}
