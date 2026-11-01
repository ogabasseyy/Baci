type ProbeResult = 'valid' | 'auth-rejected' | 'indeterminate';

/** Select a credential using only a probe that cannot claim or change work. */
export async function selectGiglWorkerCredential<T>(
  primary: T,
  secondary: T | undefined,
  probe: (credential: T) => Promise<ProbeResult>
): Promise<T> {
  const primaryResult = await probe(primary);
  if (primaryResult === 'valid') return primary;
  if (primaryResult === 'auth-rejected' && secondary !== undefined) {
    if ((await probe(secondary)) === 'valid') return secondary;
  }
  throw new Error('GIGL tracking worker credential could not be verified');
}
