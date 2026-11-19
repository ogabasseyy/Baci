import { chromium } from 'playwright';
import { storefrontAuthority } from './config.mjs';

export async function launchIsolatedBrowser(state) {
  const { blockedOrigins, browserSignals } = state;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname !== storefrontAuthority) {
      blockedOrigins.add(requestUrl.origin);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' && browserSignals.consoleErrors.length < 6) {
      browserSignals.consoleErrors.push(
        message
          .text()
          .replace(/([?&]website_token=)[^&\s)]+/gi, '$1[redacted]')
          .replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]')
          .slice(0, 260)
      );
    }
  });
  page.on('pageerror', () => {
    browserSignals.pageErrors += 1;
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).hostname === storefrontAuthority) {
      browserSignals.failedLocalRequests += 1;
    }
  });
  state.browser = browser;
  state.page = page;
  return context;
}
