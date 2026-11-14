export function shouldHandleColdStartResponse(
  hasResponse: boolean,
  hasNewerLiveResponse: boolean
): boolean {
  return hasResponse && !hasNewerLiveResponse;
}
