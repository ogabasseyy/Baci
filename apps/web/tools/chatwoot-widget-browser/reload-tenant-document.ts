declare const __CHATWOOT_FIXTURE_RESET_DELAY_MS__: number;

export function reloadChatwootTenantDocument(): void {
  if (__CHATWOOT_FIXTURE_RESET_DELAY_MS__ === 0) {
    window.location.reload();
    return;
  }

  window.setTimeout(
    () => window.location.reload(),
    __CHATWOOT_FIXTURE_RESET_DELAY_MS__
  );
}
