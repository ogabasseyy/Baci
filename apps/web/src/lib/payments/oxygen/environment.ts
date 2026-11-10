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
  // Non-Vercel production requires an explicit production selection.
  if (process.env.NODE_ENV === 'production')
    return explicit === 'production' ? 'production' : null;
  // Only local development and tests may default to staging without Vercel.
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
    return null;
  return explicit === 'production' ? null : 'staging';
}
