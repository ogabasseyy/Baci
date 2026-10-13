export function setJumiaDiscoveryRecoveryHeader(
  response: Response,
  recoveryDiscoveryId: string | undefined
): boolean {
  const discoveryComplete =
    response.headers.get('x-jumia-discovery-complete') !== 'false';
  if (recoveryDiscoveryId && (!response.ok || !discoveryComplete))
    response.headers.set('x-jumia-discovery-id', recoveryDiscoveryId);
  return discoveryComplete;
}
