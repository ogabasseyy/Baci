/** 1 when the provider's own status code is MSHC (a number so it can be used as a sort key). */
export function isMshc(candidate: { providerStatus: string }): number {
  return candidate.providerStatus.trim().toUpperCase() === 'MSHC' ? 1 : 0;
}
