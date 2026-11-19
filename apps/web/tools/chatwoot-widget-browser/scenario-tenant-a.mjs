import assert from 'node:assert/strict';
import {
  platformOrigin,
  resetDelayMs,
  storefrontOrigin,
  tokenA,
} from './config.mjs';
import { readChatwootCookieMetadata } from './cookie-diagnostics.mjs';
import { cookieClaims, instrumentReset } from './page-scripts.mjs';
import { sendSyntheticMessage } from './send-synthetic-message.mjs';

export async function runTenantA(state, context) {
  const { page } = state;
  state.phase = 'tenant A ready';
  await page.goto(`${storefrontOrigin}/synthetic-tenant-a/checkout?tenant=a`);
  assert.equal(
    await page.evaluate(
      () => window.__chatwootFixtureDocumentStart?.chatwootCookieCount
    ),
    0,
    'Isolated browser context started with stale Chatwoot cookies'
  );
  await page.waitForFunction(
    ({ expectedToken, expectedBaseUrl }) => {
      const target = window;
      return (
        target.$chatwoot?.websiteToken === expectedToken &&
        target.$chatwoot?.baseUrl === expectedBaseUrl &&
        target.__baciChatwootReadyKey?.includes(expectedToken)
      );
    },
    { expectedToken: tokenA, expectedBaseUrl: platformOrigin },
    { timeout: 60_000 }
  );
  const tenantAClaims = await page.evaluate(cookieClaims);
  assert.ok(
    tenantAClaims?.inbox_id,
    'Tenant A did not receive a widget session cookie'
  );
  state.tenantAInboxId = tenantAClaims.inbox_id;
  await page.evaluate((inboxId) => {
    sessionStorage.setItem('__chatwootPreviousInbox', String(inboxId));
  }, tenantAClaims.inbox_id);
  const tenantAWidgetFrame = page
    .frames()
    .find((frame) => new URL(frame.url()).pathname === '/widget');
  assert.ok(tenantAWidgetFrame, 'Tenant A Chatwoot widget frame was not found');
  const widgetToggleAvailable = await page.evaluate(
    () => typeof window.$chatwoot?.toggle === 'function'
  );
  assert.ok(
    widgetToggleAvailable,
    'Tenant A widget cannot be opened for the synthetic message check'
  );
  await page.evaluate(() => window.$chatwoot.toggle('open'));
  await tenantAWidgetFrame
    .getByRole('button', { name: 'Start Conversation' })
    .click({ timeout: 10_000 });
  state.phase = 'send synthetic tenant A message';
  const syntheticAMessage = await sendSyntheticMessage(
    page,
    tenantAWidgetFrame
  );
  // Deterministic precondition: the switch must not start until tenant A's
  // conversation cookie is present and still belongs to tenant A's inbox.
  await page.waitForFunction(
    ({ inboxId }) =>
      sessionStorage.getItem('__chatwootPreviousInbox') === String(inboxId) &&
      document.cookie.split('; ').some((c) => c.startsWith('cw_conversation=')),
    { inboxId: tenantAClaims.inbox_id },
    { timeout: 15_000 }
  );
  const settledClaims = await page.evaluate(cookieClaims);
  assert.equal(
    String(settledClaims?.inbox_id),
    String(tenantAClaims.inbox_id),
    'Tenant A conversation cookie was not present before the tenant switch'
  );
  state.tenantACookieMetadata = await readChatwootCookieMetadata(context);
  await page.evaluate(instrumentReset, resetDelayMs);

  return { tenantAClaims, syntheticAMessage };
}
