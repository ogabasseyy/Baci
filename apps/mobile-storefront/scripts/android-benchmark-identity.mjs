/** Validate the build target against the existing Firebase client, without evaluating app config. */
export function resolveBenchmarkIdentity(appConfigSource, googleServicesSource, useInstalledDebugPackage) {
  const matches = [...appConfigSource.matchAll(/^\s*package:\s*['"]([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)['"]\s*,/gm)];
  if (matches.length !== 1) throw new Error('Could not determine one Android package from the storefront app config.');
  const suffix = useInstalledDebugPackage ? '' : '.benchmark';
  const targetPackage = matches[0][1] + suffix;
  let services;
  try { services = JSON.parse(googleServicesSource); }
  catch { throw new Error('The existing Firebase configuration could not be parsed.'); }
  const clients = Array.isArray(services?.client) ? services.client : [];
  if (!clients.some((client) => client?.client_info?.android_client_info?.package_name === targetPackage)) {
    throw new Error(`Existing Firebase configuration has no Android client for ${targetPackage}.`);
  }
  return { targetPackage, suffix };
}
