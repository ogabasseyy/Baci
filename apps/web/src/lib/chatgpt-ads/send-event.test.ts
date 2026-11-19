import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatgptPaidEvent } from './paid-event';
import { sendChatgptEvent } from './send-event';

const event: ChatgptPaidEvent = {
  id: 'id',
  type: 'order_created',
  timestamp_ms: 1792836000000,
  source_url: 'https://ogabassey.com',
  action_source: 'web',
  opt_out: true,
  user: {},
  data: { type: 'contents', amount: 100, currency: 'NGN' },
};
afterEach(() => vi.unstubAllGlobals());
describe('sendChatgptEvent', () => {
  it('sends the authenticated event only to the official endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetch);
    expect(await sendChatgptEvent('pixel', 'secret', event)).toEqual({
      success: true,
      httpStatus: 200,
    });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://bzr.openai.com/v1/events?pid=pixel'
    );
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toMatchObject({
      integration_source: 'baci',
      events: [{ id: 'id' }],
    });
    expect(options.headers.Authorization).toBe('Bearer secret');
  });
  it('does not expose provider error bodies or transport errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('secret customer-data', { status: 401 })
        )
    );
    expect(await sendChatgptEvent('pixel', 'secret', event)).toEqual({
      success: false,
      httpStatus: 401,
      error: 'provider_rejected',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Bearer secret'))
    );
    expect(await sendChatgptEvent('pixel', 'secret', event)).toEqual({
      success: false,
      error: 'provider_transport_failed',
    });
  });
});
