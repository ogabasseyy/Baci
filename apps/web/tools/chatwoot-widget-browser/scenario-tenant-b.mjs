import assert from 'node:assert/strict';
import { tokenB } from './config.mjs';
import { readChatwootCookieMetadata } from './cookie-diagnostics.mjs';
import { collectTenantBResult, probeUntrustedFrame } from './page-scripts.mjs';

export async function runTenantB(
  state,
  context,
  { tenantAClaims, syntheticAMessage }
) {
  const { page, blockedOrigins } = state;
  state.phase = 'defer tenant switch during checkout';
  await page.getByRole('button', { name: 'Switch to tenant B' }).click();
  await page.waitForFunction(
    () =>
      location.pathname.endsWith('/checkout') &&
      document.querySelector('[data-testid="fixture-route"]')?.textContent ===
        'checkout' &&
      document.querySelector('[data-testid="bridge-tenant"]') === null
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('__chatwootFixtureLoads')),
    '1'
  );
  assert.equal(
    await page.evaluate(() => location.pathname),
    '/synthetic-tenant-b/checkout'
  );

  state.phase = 'reset tenant A before reloading as tenant B';
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: 'Continue outside checkout' }).click(),
  ]);
  state.tenantBDocumentCookieMetadata =
    await readChatwootCookieMetadata(context);
  await page.waitForFunction(
    ({ expectedToken }) => {
      const target = window;
      return (
        target.$chatwoot?.websiteToken === expectedToken &&
        target.__baciChatwootReadyKey?.includes(expectedToken) &&
        target.__chatwootFixtureDocumentStart?.loads === 2
      );
    },
    { expectedToken: tokenB },
    { timeout: 60_000 }
  );
  state.tenantBResult = await page.evaluate(collectTenantBResult);
  state.untrustedFrameProbe = await page.evaluate(probeUntrustedFrame, {
    marker: 'baci-synthetic-untrusted-iframe-cookie',
    widgetMessage: `chatwoot-widget:${JSON.stringify({
      event: 'loaded',
      config: { authToken: 'baci-synthetic-untrusted-iframe-cookie' },
    })}`,
  });
  state.phase = 'assert tenant B isolation';
  await page.evaluate(() => window.$chatwoot?.toggle?.('open'));
  const tenantBWidgetFrame = page
    .frames()
    .find((frame) => new URL(frame.url()).pathname === '/widget');
  assert.ok(tenantBWidgetFrame, 'Tenant B Chatwoot widget frame was not found');
  await tenantBWidgetFrame
    .getByRole('button', { name: 'Start Conversation' })
    .waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  const tenantBMessageCount = await tenantBWidgetFrame
    .getByText(syntheticAMessage, { exact: true })
    .count();
  assert.equal(
    tenantBMessageCount,
    0,
    'Tenant A synthetic message appeared in tenant B widget'
  );
  assert.equal(
    state.tenantBResult.documentStart?.conversationCookieMatchesPreviousInbox,
    false,
    'Tenant A conversation cookie remained at tenant B document start'
  );
  assert.equal(
    state.tenantBResult.documentStart?.chatwootCookieCount,
    0,
    'A stale Chatwoot cookie remained at tenant B document start'
  );
  assert.deepEqual(state.tenantBResult.resetEvidence, {
    beforeMatchesTenantA: true,
    afterMatchesTenantA: false,
  });
  assert.equal(
    state.tenantBResult.previousInbox,
    String(tenantAClaims.inbox_id)
  );
  assert.notEqual(state.tenantBResult.currentInbox, tenantAClaims.inbox_id);
  assert.equal(state.tenantBResult.bridgeTenant, 'synthetic-tenant-b');
  assert.deepEqual([...blockedOrigins], []);
  console.log(
    `Sanitized reset cookie evidence: ${JSON.stringify({
      resetEvidence: state.tenantBResult.resetEvidence,
      postResetLoadedEvents: state.tenantBResult.postResetLoadedEvents,
      resetCookieTransitions: state.tenantBResult.resetCookieTransitions,
      tenantACookieMetadata: state.tenantACookieMetadata,
      tenantBDocumentCookieMetadata: state.tenantBDocumentCookieMetadata,
      tenantBStartCookiePresent: Boolean(
        state.tenantBResult.documentStart?.conversationCookiePresent
      ),
      untrustedFrameProbe: state.untrustedFrameProbe,
    })}`
  );
  await context.close();
  console.log(
    'Synthetic Chatwoot lifecycle passed: tenant A message visible in A and absent in B; no external origins requested.'
  );
}
