import { describe, expect, it, vi } from 'vitest';
import {
  isWithinQuietHours,
  parseExpoTicketResults,
  processScheduledNotificationClaims,
} from './scheduled-notification-delivery.ts';

describe('parseExpoTicketResults', () => {
  it('preserves each mixed Expo ticket result for its corresponding token', () => {
    const result = parseExpoTicketResults(
      {
        data: [
          { id: 'ticket-accepted', status: 'ok' },
          { details: { error: 'DeviceNotRegistered' }, status: 'error' },
        ],
      },
      2
    );

    expect(result).toEqual({
      errorCodes: ['', 'DeviceNotRegistered'],
      statuses: ['accepted', 'rejected'],
      ticketIds: ['ticket-accepted', ''],
    });
  });

  it('marks malformed or incomplete provider responses as unresolved', () => {
    expect(parseExpoTicketResults({ data: [{ status: 'ok' }] }, 2)).toBeNull();
    expect(
      parseExpoTicketResults({ data: [{ status: 'pending' }] }, 1)
    ).toBeNull();
    expect(
      parseExpoTicketResults({ data: [{ status: 'error' }] }, 1)
    ).toBeNull();
  });
});

describe('isWithinQuietHours', () => {
  it('handles overnight windows in the merchant timezone', () => {
    const atNight = new Date('2026-08-11T22:30:00.000Z');
    expect(isWithinQuietHours(atNight, '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(atNight, '07:00', '22:00')).toBe(false);
  });

  it('uses the recipient timezone rather than the worker timezone', () => {
    const instant = new Date('2026-08-11T06:30:00.000Z');

    expect(
      isWithinQuietHours(instant, '22:00', '07:00', 'America/New_York')
    ).toBe(true);
    expect(isWithinQuietHours(instant, '22:00', '07:00', 'Africa/Lagos')).toBe(
      false
    );
  });
});

describe('processScheduledNotificationClaims', () => {
  it('defers a quiet-hour push without marking the broadcast sent or consuming a retry', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const claim = {
      action_url: null,
      channels: ['push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174008',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f8',
      message: 'Quiet notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Quiet',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return {
            data: [{ merchant_id: '456e4567-e89b-42d3-a456-426614174000' }],
            error: null,
          };
        }
        if (name === 'get_claimed_notification_push_tokens_v1') {
          return {
            data: [
              {
                push_token: 'ExponentPushToken[quiet-token]',
                quiet_hours_end: '23:59',
                quiet_hours_start: '00:00',
                quiet_hours_time_zone: 'Africa/Lagos',
              },
            ],
            error: null,
          };
        }
        if (name === 'defer_notification_push_tokens_v1') {
          return { data: 1, error: null };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 1, status: 'deferred' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'deferred' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    expect(
      calls.some((call) => call.name === 'reserve_notification_push_batch_v1')
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it('defers mixed-channel broadcasts so quiet-hour pushes stay claimable', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const claim = {
      action_url: null,
      channels: ['in_app', 'push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174009',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f9',
      message: 'Mixed visible and quiet push notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Mixed visible',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return {
            data: [{ merchant_id: '456e4567-e89b-42d3-a456-426614174000' }],
            error: null,
          };
        }
        if (name === 'get_claimed_notification_push_tokens_v1') {
          return {
            data: [
              {
                push_token: 'ExponentPushToken[quiet-token]',
                quiet_hours_end: '23:59',
                quiet_hours_start: '00:00',
                quiet_hours_time_zone: 'Africa/Lagos',
              },
            ],
            error: null,
          };
        }
        if (name === 'defer_notification_push_tokens_v1') {
          return { data: 1, error: null };
        }
        if (name === 'get_notification_push_outbox_summary_v1') {
          return {
            data: {
              dispatching: 0,
              pending: 0,
              rejected: 0,
              unknown: 0,
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 1, status: 'deferred' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_notification_id: claim.id,
      }),
      name: 'create_claimed_admin_notification_recipients_v1',
    });
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'deferred' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    expect(calls).not.toContainEqual({
      args: expect.objectContaining({ p_outcome: 'sent' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    vi.unstubAllGlobals();
  });

  it('sends non-quiet tokens before deferring the same broadcast', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: 'expo-ticket', status: 'ok' }] }),
            {
              status: 200,
            }
          )
      )
    );
    const claim = {
      action_url: null,
      channels: ['push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174010',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3fa',
      message: 'Mixed quiet notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Mixed',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return {
            data: [{ merchant_id: '456e4567-e89b-42d3-a456-426614174000' }],
            error: null,
          };
        }
        if (name === 'get_claimed_notification_push_tokens_v1') {
          return {
            data: [
              {
                push_token: 'ExponentPushToken[quiet-token]',
                quiet_hours_end: '23:59',
                quiet_hours_start: '00:00',
                quiet_hours_time_zone: 'Africa/Lagos',
              },
              {
                push_token: 'ExponentPushToken[ready-token]',
                quiet_hours_end: '07:00',
                quiet_hours_start: '22:00',
                quiet_hours_time_zone: 'America/New_York',
              },
            ],
            error: null,
          };
        }
        if (name === 'reserve_notification_push_batch_v1') {
          return {
            data: [{ push_token: 'ExponentPushToken[ready-token]' }],
            error: null,
          };
        }
        if (name === 'defer_notification_push_tokens_v1') {
          return { data: 1, error: null };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 1, status: 'deferred' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_tokens: ['ExponentPushToken[ready-token]'],
      }),
      name: 'reserve_notification_push_batch_v1',
    });
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'deferred' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    vi.unstubAllGlobals();
  });

  it('finalizes as expired when expiry is reached after claim processing begins', async () => {
    const claim = {
      action_url: null,
      channels: ['in_app'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174099',
      expires_at: '2020-01-01T00:00:00.000Z',
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f9',
      message: 'Expired notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Expired',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([{ id: claim.id, status: 'expired' }]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'expired' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
  });

  it('continues later claims when a renewal loses an earlier claim', async () => {
    const lostClaim = {
      action_url: null,
      channels: ['in_app'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
      message: 'First notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'First',
    };
    const validClaim = {
      ...lostClaim,
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174003',
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f2',
      message: 'Second notification',
      title: 'Second',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'renew_scheduled_notification_claim_v1') {
          return {
            data: args?.p_notification_id !== lostClaim.id,
            error: null,
          };
        }
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return { data: [], error: null };
        }
        if (name === 'get_notification_push_outbox_summary_v1') {
          return { data: {}, error: null };
        }
        if (name === 'finalize_scheduled_admin_notification_v1') {
          return {
            data: args?.p_notification_id !== lostClaim.id,
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [
      lostClaim,
      validClaim,
    ]);

    expect(results).toEqual([
      { id: validClaim.id, recipients: 0, status: 'sent' },
    ]);
    expect(calls).not.toContainEqual({
      args: expect.objectContaining({
        p_notification_id: lostClaim.id,
        p_outcome: 'retry',
      }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
  });

  it('does not defer a broadcast when only already-delivered tokens are quiet', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const claim = {
      action_url: null,
      channels: ['push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174011',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3fb',
      message: 'Follow-up quiet notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Follow-up',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return {
            data: [{ merchant_id: '456e4567-e89b-42d3-a456-426614174000' }],
            error: null,
          };
        }
        if (name === 'get_claimed_notification_push_tokens_v1') {
          return {
            data: [
              {
                push_token: 'ExponentPushToken[already-delivered]',
                quiet_hours_end: '23:59',
                quiet_hours_start: '00:00',
                quiet_hours_time_zone: 'Africa/Lagos',
              },
            ],
            error: null,
          };
        }
        if (name === 'defer_notification_push_tokens_v1') {
          return { data: 0, error: null };
        }
        if (name === 'get_notification_push_outbox_summary_v1') {
          return {
            data: {
              dispatching: 0,
              pending: 0,
              rejected: 0,
              unknown: 0,
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 1, status: 'sent' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'sent' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    expect(calls).not.toContainEqual({
      args: expect.objectContaining({ p_outcome: 'deferred' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    vi.unstubAllGlobals();
  });

  it('finalizes push-only broadcasts without in-app recipients as sent', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const claim = {
      action_url: null,
      channels: ['push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174012',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3fc',
      message: 'Push-only notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Push-only',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return { data: [], error: null };
        }
        if (name === 'get_notification_push_outbox_summary_v1') {
          return {
            data: {
              dispatching: 0,
              pending: 0,
              rejected: 0,
              unknown: 0,
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 0, status: 'sent' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({ p_outcome: 'sent' }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    vi.unstubAllGlobals();
  });

  it('still dispatches ready tokens on later audience pages after a quiet first page', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: 'expo-ticket', status: 'ok' }] }),
            { status: 200 }
          )
      )
    );
    const claim = {
      action_url: null,
      channels: ['push'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174013',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3fd',
      message: 'Paged quiet notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Paged',
    };
    const firstPageMerchant = '456e4567-e89b-42d3-a456-426614174001';
    const secondPageMerchant = '456e4567-e89b-42d3-a456-426614174002';
    const firstPageMerchants = Array.from({ length: 500 }, (_, index) =>
      index === 0
        ? firstPageMerchant
        : `456e4567-e89b-42d3-a456-${String(1000 + index).padStart(12, '0')}`
    );
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          const after = args?.p_after_merchant_id;
          return {
            data: after
              ? [{ merchant_id: secondPageMerchant }]
              : firstPageMerchants.map((merchant_id) => ({ merchant_id })),
            error: null,
          };
        }
        if (name === 'get_claimed_notification_push_tokens_v1') {
          const merchants = args?.p_merchant_ids as string[];
          if (merchants.includes(firstPageMerchant)) {
            return {
              data: [
                {
                  push_token: 'ExponentPushToken[quiet-token]',
                  quiet_hours_end: '23:59',
                  quiet_hours_start: '00:00',
                  quiet_hours_time_zone: 'Africa/Lagos',
                },
              ],
              error: null,
            };
          }
          return {
            data: [
              {
                push_token: 'ExponentPushToken[ready-token-page-2]',
                quiet_hours_end: '07:00',
                quiet_hours_start: '22:00',
                quiet_hours_time_zone: 'America/New_York',
              },
            ],
            error: null,
          };
        }
        if (name === 'defer_notification_push_tokens_v1') {
          return { data: 1, error: null };
        }
        if (name === 'reserve_notification_push_batch_v1') {
          return {
            data: [{ push_token: 'ExponentPushToken[ready-token-page-2]' }],
            error: null,
          };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [claim]);

    expect(results).toEqual([
      { id: claim.id, recipients: 501, status: 'deferred' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_tokens: ['ExponentPushToken[ready-token-page-2]'],
      }),
      name: 'reserve_notification_push_batch_v1',
    });
    vi.unstubAllGlobals();
  });

  it('continues later claims when an earlier claim is malformed', async () => {
    const malformedClaim = {
      action_url: null,
      channels: ['in_app'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174004',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f3',
      message: 'Broken notification',
      target_merchant_ids: null,
      target_segment: null,
      target_type: 'all',
      title: '',
    };
    const validClaim = {
      action_url: null,
      channels: ['in_app'],
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174005',
      expires_at: null,
      id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f4',
      message: 'Valid notification',
      target_merchant_ids: [],
      target_segment: null,
      target_type: 'all',
      title: 'Valid',
    };
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = [];
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ args, name });
        if (name === 'get_scheduled_notification_recipient_page_v1') {
          return { data: [], error: null };
        }
        if (name === 'get_notification_push_outbox_summary_v1') {
          return { data: {}, error: null };
        }
        return { data: true, error: null };
      },
    };

    const results = await processScheduledNotificationClaims(client, [
      malformedClaim,
      validClaim,
    ]);

    expect(results).toEqual([
      { id: malformedClaim.id, status: 'retry' },
      { id: validClaim.id, recipients: 0, status: 'sent' },
    ]);
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_notification_id: malformedClaim.id,
        p_outcome: 'retry',
      }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
    expect(calls).toContainEqual({
      args: expect.objectContaining({
        p_notification_id: validClaim.id,
        p_outcome: 'sent',
      }),
      name: 'finalize_scheduled_admin_notification_v1',
    });
  });
});
