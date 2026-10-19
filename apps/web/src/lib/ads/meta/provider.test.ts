import { describe, expect, it, vi } from 'vitest';
import {
  fetchMetaAdsDailyInsights,
  listMetaAdsAccounts,
  parseMetaAdsDailyInsights,
  validateMetaAdsGrant,
} from './provider';

describe('Meta Ads provider', () => {
  it('follows server-side account pagination and preserves canonical act_ ids', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                account_status: 1,
                id: 'act_1',
                currency: 'NGN',
                name: 'First',
                timezone_name: 'Africa/Lagos',
              },
            ],
            paging: {
              next: 'https://graph.facebook.com/v25.0/me/adaccounts?after=next',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                account_status: 1,
                id: 'act_2',
                currency: 'USD',
                name: 'Second',
                timezone_name: 'America/New_York',
              },
            ],
          }),
          { status: 200 }
        )
      );
    await expect(
      listMetaAdsAccounts('access', fetchImpl)
    ).resolves.toMatchObject([{ accountId: 'act_1' }, { accountId: 'act_2' }]);
  });

  it('shares the retry-wait budget across account pages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 613 } }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                account_status: 1,
                currency: 'NGN',
                id: 'act_1',
                name: 'First',
                timezone_name: 'Africa/Lagos',
              },
            ],
            paging: {
              next: 'https://graph.facebook.com/v25.0/me/adaccounts?after=next',
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 613 } }), {
          headers: { 'retry-after': '6' },
          status: 429,
        })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      listMetaAdsAccounts('access', fetchImpl, sleep)
    ).rejects.toMatchObject({
      code: 'META_ADS_THROTTLED',
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(6_000);
  });

  it('preserves exact decimal spend and provider-labelled action values', () => {
    expect(
      parseMetaAdsDailyInsights(
        {
          data: [
            {
              account_id: '12',
              date_start: '2026-08-20',
              date_stop: '2026-08-20',
              spend: '123.456789123',
              impressions: '10',
              clicks: '2',
              reach: '9',
              actions: [{ action_type: 'purchase', value: '1' }],
              action_values: [{ action_type: 'purchase', value: '99.95' }],
            },
          ],
        },
        'act_12'
      )
    ).toEqual([
      expect.objectContaining({
        spendAmountDecimal: '123.456789123',
        actions: [{ actionType: 'purchase', value: '1' }],
        actionValues: [{ actionType: 'purchase', value: '99.95' }],
      }),
    ]);
  });

  it('does not expose provider error bodies and retries throttles with bounded backoff', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 613, message: 'secret error body' },
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchMetaAdsDailyInsights(
        {
          accessToken: 'access',
          accountId: 'act_1',
          startDate: '2026-08-20',
          endDate: '2026-08-20',
        },
        fetchImpl,
        sleep
      )
    ).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('retains only safe usage/reset telemetry and honors a bounded reset hint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 613 } }), {
          headers: {
            'x-ad-account-usage': JSON.stringify({ call_count: 10 }),
            'x-fb-ads-insights-throttle': JSON.stringify({
              estimated_time_to_regain_access: 3,
            }),
          },
          status: 400,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const telemetry = vi.fn();
    await fetchMetaAdsDailyInsights(
      {
        accessToken: 'access',
        accountId: 'act_1',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
      },
      fetchImpl,
      sleep,
      telemetry
    );
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(telemetry).toHaveBeenNthCalledWith(1, {
      adAccountCallCount: 10,
      businessUseCaseCallCount: null,
      insightsThrottleResetSeconds: 3,
    });
  });

  it('collects every bounded same-origin Insights page before returning rows', async () => {
    const firstRow = {
      account_id: '1',
      clicks: '1',
      date_start: '2026-08-20',
      date_stop: '2026-08-20',
      impressions: '2',
      spend: '3.10',
    };
    const secondRow = {
      ...firstRow,
      date_start: '2026-08-21',
      date_stop: '2026-08-21',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [firstRow],
            paging: {
              next: 'https://graph.facebook.com/v25.0/act_1/insights?after=next',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [secondRow] }), { status: 200 })
      );
    await expect(
      fetchMetaAdsDailyInsights(
        {
          accessToken: 'access',
          accountId: 'act_1',
          endDate: '2026-08-21',
          startDate: '2026-08-20',
        },
        fetchImpl
      )
    ).resolves.toHaveLength(2);
  });

  it('validates user-token type, provider identity, expiry, and ads_read', async () => {
    const successResponses = () => [
      new Response(
        JSON.stringify({
          data: {
            app_id: 'app',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            is_valid: true,
            type: 'USER',
            user_id: 'provider-user',
          },
        }),
        { status: 200 }
      ),
      new Response(JSON.stringify({ id: 'provider-user' }), { status: 200 }),
      new Response(
        JSON.stringify({
          data: [{ permission: 'ads_read', status: 'granted' }],
        }),
        { status: 200 }
      ),
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of successResponses())
      fetchImpl.mockResolvedValueOnce(response);
    await expect(
      validateMetaAdsGrant(
        { accessToken: 'access', appId: 'app', appSecret: 'secret' },
        fetchImpl
      )
    ).resolves.toEqual({ providerUserId: 'provider-user' });

    for (const data of [
      {
        app_id: 'app',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        is_valid: true,
        type: 'APP',
        user_id: 'provider-user',
      },
      {
        app_id: 'app',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        is_valid: true,
        type: 'USER',
      },
      {
        app_id: 'app',
        expires_at: Math.floor(Date.now() / 1000) - 1,
        is_valid: true,
        type: 'USER',
        user_id: 'provider-user',
      },
    ]) {
      const rejected = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data }), { status: 200 })
        );
      await expect(
        validateMetaAdsGrant(
          { accessToken: 'access', appId: 'app', appSecret: 'secret' },
          rejected
        )
      ).rejects.toMatchObject({ code: 'META_ADS_TOKEN_INVALID' });
    }
    const mismatch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              app_id: 'app',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              is_valid: true,
              type: 'USER',
              user_id: 'provider-user',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'another-user' }), { status: 200 })
      );
    await expect(
      validateMetaAdsGrant(
        { accessToken: 'access', appId: 'app', appSecret: 'secret' },
        mismatch
      )
    ).rejects.toMatchObject({ code: 'META_ADS_PROVIDER_IDENTITY_MISMATCH' });
  });
});
