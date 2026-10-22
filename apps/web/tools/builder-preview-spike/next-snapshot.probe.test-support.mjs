/** Actual Next client-rendered public adapter, isolated loopback fixture. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 768, height: 1000 },
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const versions = [];
  for (const revision of [1, 2]) {
    const response = await context.request.get(
      `https://127.0.0.1:31987/api/published-home?revision=${revision}`
    );
    assert.equal(response.status(), 200);
    const dto = await response.json();
    await page.goto(`https://127.0.0.1:31987/?revision=${revision}`);
    await page
      .getByText('Authorized fixture camera')
      .waitFor({ timeout: 30000 });
    const marker = page.locator('[data-published-version]');
    assert.equal(
      await marker.getAttribute('data-published-version'),
      dto.publishedVersion
    );
    await page
      .getByRole('heading', {
        name: revision === 1 ? 'Our cameras' : 'Updated published cameras',
      })
      .waitFor();
    assert.equal(await page.locator('[data-baci-block]').count(), 6);
    versions.push(dto.publishedVersion);
  }
  assert.notEqual(versions[0], versions[1]);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        revisions: 2,
        versions,
        blocks: 6,
        host: 'real Next HTTPS client-loaded public renderer',
      },
      null,
      2
    )
  );
} finally {
  await context.close();
  await browser.close();
}
