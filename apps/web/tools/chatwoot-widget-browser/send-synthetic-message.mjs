import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const syntheticMessagePrefix = 'BACI-SYNTHETIC-TENANT-A-ONLY-';

export async function sendSyntheticMessage(page, widgetFrame) {
  const message = `${syntheticMessagePrefix}${randomUUID()}`;
  const composer = widgetFrame.getByPlaceholder('Type your message');
  await composer.waitFor({ state: 'visible', timeout: 10_000 });

  const messageResponse = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/messages')
    );
  });
  await composer.fill(message);
  await composer.press('Enter');

  const deliveredMessageResponse = await messageResponse;
  assert.ok(
    deliveredMessageResponse.ok(),
    'Synthetic Chatwoot message request was not accepted'
  );
  await widgetFrame.getByText(message, { exact: true }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  assert.equal(
    await widgetFrame.getByText(message, { exact: true }).count(),
    1,
    'Synthetic Chatwoot message was not uniquely visible in its tenant'
  );
  return message;
}
