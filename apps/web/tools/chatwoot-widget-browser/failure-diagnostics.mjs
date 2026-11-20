import { tokenA, tokenB } from './config.mjs';

export async function reportFailure(error, state) {
  const { page, blockedOrigins, browserSignals } = state;
  const safeError = String(error?.message ?? error ?? 'Unknown error')
    .replaceAll(tokenA, '[tenant A token redacted]')
    .replaceAll(tokenB, '[tenant B token redacted]')
    .replace(/([?&]website_token=)[^&\s)]+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .slice(0, 800);
  console.error(
    `Synthetic Chatwoot browser lifecycle failed during: ${state.phase} (${error?.name ?? 'Error'}): ${safeError}`
  );
  if (page && state.phase === 'tenant A ready') {
    const diagnostic = await page
      .evaluate(() => {
        const target = window;
        return {
          sdkRunAvailable: typeof target.chatwootSDK?.run === 'function',
          widgetGlobalCreated: Boolean(target.$chatwoot),
          iframeCreated: Boolean(
            document.getElementById('chatwoot_live_chat_widget')
          ),
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          pagePath: location.pathname,
          scriptPaths: [...document.scripts].map((script) => {
            try {
              return new URL(script.src).pathname;
            } catch {
              return 'inline';
            }
          }),
          readyEventRecorded: Boolean(target.__baciChatwootReadyKey),
          cspViolations: target.__chatwootFixtureCspViolations ?? [],
        };
      })
      .catch(() => ({ pageUnavailable: true }));
    console.error(
      `Sanitized browser diagnostics: ${JSON.stringify({ ...diagnostic, ...browserSignals })}`
    );
  } else if (page && state.phase === 'assert tenant B isolation') {
    console.error(
      `Sanitized final assertion diagnostics: ${JSON.stringify({
        pagePath: '/synthetic-tenant-b/product',
        documentStartCookiePresent: Boolean(
          state.tenantBResult?.documentStart?.conversationCookiePresent
        ),
        documentStartChatwootCookieCount:
          state.tenantBResult?.documentStart?.chatwootCookieCount ?? null,
        documentStartCookieMatchesTenantA: Boolean(
          state.tenantBResult?.documentStart
            ?.conversationCookieMatchesPreviousInbox
        ),
        resetEvidence: state.tenantBResult?.resetEvidence ?? null,
        resetCookieTransitions:
          state.tenantBResult?.resetCookieTransitions ?? [],
        postResetLoadedEvents: state.tenantBResult?.postResetLoadedEvents ?? [],
        untrustedFrameProbe: state.untrustedFrameProbe,
        tenantACookieMetadata: state.tenantACookieMetadata,
        tenantBDocumentCookieMetadata: state.tenantBDocumentCookieMetadata,
        previousInboxMatchesTenantA:
          state.tenantBResult?.previousInbox === String(state.tenantAInboxId),
        currentInboxMatchesTenantA:
          String(state.tenantBResult?.currentInbox) ===
          String(state.tenantAInboxId),
        bridgeTenant: state.tenantBResult?.bridgeTenant ?? null,
        blockedOrigins: [...blockedOrigins],
        ...browserSignals,
      })}`
    );
  } else if (
    page &&
    state.phase === 'reset tenant A before reloading as tenant B'
  ) {
    // Intentionally boolean-only: never expose conversation or inbox IDs.
    const diagnostic = await page
      .evaluate((expectedToken) => {
        const target = window;
        const rawCookie = document.cookie
          .split('; ')
          .find((entry) => entry.startsWith('cw_conversation='))
          ?.slice('cw_conversation='.length);
        let current;
        if (rawCookie) {
          const payload = rawCookie
            .split('.')[1]
            ?.replace(/-/g, '+')
            .replace(/_/g, '/');
          if (payload) {
            try {
              current = JSON.parse(
                atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
              );
            } catch {
              current = undefined;
            }
          }
        }
        const previous = sessionStorage.getItem('__chatwootPreviousInbox');
        return {
          pagePath: location.pathname,
          fixtureLoads: sessionStorage.getItem('__chatwootFixtureLoads'),
          documentStart: target.__chatwootFixtureDocumentStart ?? null,
          cookiePresent: Boolean(current),
          currentInboxMatchesPrevious: Boolean(
            current?.inbox_id && String(current.inbox_id) === previous
          ),
          bridgeTenant:
            document.querySelector('[data-testid="bridge-tenant"]')
              ?.textContent ?? null,
          readyForTenantB: Boolean(
            target.__baciChatwootReadyKey?.includes(expectedToken)
          ),
        };
      }, tokenB)
      .catch(() => ({ pageUnavailable: true }));
    console.error(
      `Sanitized final assertion diagnostics: ${JSON.stringify({ ...diagnostic, blockedOrigins: [...blockedOrigins], ...browserSignals })}`
    );
  }
}
