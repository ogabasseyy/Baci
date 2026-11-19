import { afterEach, describe, expect, it, vi } from 'vitest';
import { binding, stubFetch } from './merchant-inbox-client.test-support';
import { getMerchantInboxInsights } from './merchant-inbox-insights';

vi.mock('server-only', () => ({}));

afterEach(() => vi.unstubAllGlobals());

describe('getMerchantInboxInsights', () => {
  it('asks the provider only about the bound inbox over the window', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.pathname.endsWith('/conversations/filter')) {
        const label = JSON.parse(String(init?.body)).payload[1].values[0];
        return {
          body: { meta: { all_count: label === 'handled-by-ai' ? 3 : 1 } },
        };
      }
      return {
        body: {
          conversations_count: 5,
          incoming_messages_count: 20,
          outgoing_messages_count: 18,
          resolutions_count: 4,
          avg_first_response_time: 120,
          avg_resolution_time: '3600',
        },
      };
    });
    const result = await getMerchantInboxInsights(binding, {
      days: 7,
      now: 1_800_000_000_000,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v2/accounts/2/reports/summary');
    expect(url.searchParams.get('type')).toBe('inbox');
    expect(url.searchParams.get('id')).toBe('20');
    expect(url.searchParams.get('until')).toBe('1800000000');
    expect(url.searchParams.get('since')).toBe(
      String(1_800_000_000 - 7 * 86_400)
    );
    expect(result).toEqual({
      ok: true,
      insights: {
        days: 7,
        conversations: 5,
        customerMessages: 20,
        storeReplies: 18,
        resolved: 4,
        avgFirstResponseSeconds: 120,
        avgResolutionSeconds: 3600,
        handledByAi: 3,
        handledByMerchant: 1,
      },
    });
  });

  it('shows no handled counts, not zeros, when the filter read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch((url) =>
      url.pathname.endsWith('/conversations/filter')
        ? { status: 500 }
        : {
            body: {
              conversations_count: 1,
              incoming_messages_count: 1,
              outgoing_messages_count: 1,
              resolutions_count: 0,
              avg_first_response_time: null,
              avg_resolution_time: null,
            },
          }
    );
    const result = await getMerchantInboxInsights(binding, { days: 7 });
    expect(result).toMatchObject({
      ok: true,
      insights: { handledByAi: null, handledByMerchant: null },
    });
  });

  it('fails closed when the provider errors or is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 500 }));
    expect(await getMerchantInboxInsights(binding, { days: 7 })).toEqual({
      ok: false,
    });
    stubFetch(() => new Error('down'));
    expect(await getMerchantInboxInsights(binding, { days: 7 })).toEqual({
      ok: false,
    });
  });

  it('fails closed on an unreadable body', async () => {
    stubFetch(() => ({ body: 'nope' }));
    expect(await getMerchantInboxInsights(binding, { days: 7 })).toEqual({
      ok: false,
    });
  });

  it('uses the reports credential when the binding has one', async () => {
    const fetchMock = stubFetch(() => ({ body: 'nope' }));
    await getMerchantInboxInsights(
      { ...binding, reportsApiAccessToken: 'synthetic-admin-token-bbbb' },
      { days: 7 }
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).api_access_token).toBe(
      'synthetic-admin-token-bbbb'
    );
  });

  it('falls back to the agent credential without a reports credential', async () => {
    const fetchMock = stubFetch(() => ({ body: 'nope' }));
    await getMerchantInboxInsights(binding, { days: 7 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).api_access_token).toBe(
      binding.apiAccessToken
    );
  });
});
