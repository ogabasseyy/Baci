export function shouldVerifyStartupTelemetry(input: {
  appInitialized: boolean;
  loaded: boolean;
  nativeIntroSettled: boolean;
  showSplash: boolean;
  storageReady: boolean;
  timedOut: boolean;
}): boolean {
  return (
    !input.showSplash &&
    !input.timedOut &&
    input.nativeIntroSettled &&
    input.loaded &&
    input.appInitialized &&
    input.storageReady
  );
}
