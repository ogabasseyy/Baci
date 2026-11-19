import { describe, expect, it } from 'vitest';
import { scheduledNotificationTestSupport } from './scheduled-notification-delivery.test-support';

const {
  finalizeCallsFor,
  loadScheduledNotificationDelivery,
  makeMalformedScheduledNotificationClaim,
  makeScheduledNotificationClaim,
  makeScheduledNotificationTestClient,
} = scheduledNotificationTestSupport;
const FINALIZE = 'finalize_scheduled_admin_notification_v1';

describe('scheduled notification test support', () => {
  it('builds deterministic claims with a distinct id and token per suffix', () => {
    const first = makeScheduledNotificationClaim('1');
    const second = makeScheduledNotificationClaim('2');

    expect(makeScheduledNotificationClaim('1')).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(second.delivery_claim_token).not.toBe(first.delivery_claim_token);
    expect(first.channels).toEqual(['in_app']);
    expect(first.expires_at).toBeNull();
  });

  it('lets a claim override its id, channels, expiry and text', () => {
    const claim = makeScheduledNotificationClaim('3', {
      channels: ['push'],
      expiresAt: '2026-11-02T10:00:00.000Z',
      id: 'custom-id',
      message: 'Body',
      title: 'Heading',
    });

    expect(claim).toMatchObject({
      channels: ['push'],
      expires_at: '2026-11-02T10:00:00.000Z',
      id: 'custom-id',
      message: 'Body',
      title: 'Heading',
    });
  });

  it('keeps a malformed claim identifiable while breaking its content', () => {
    const valid = makeScheduledNotificationClaim('4');
    const malformed = makeMalformedScheduledNotificationClaim('4');

    expect(malformed.id).toBe(valid.id);
    expect(malformed.delivery_claim_token).toBe(valid.delivery_claim_token);
    expect(malformed.title).toBe('');
    expect(malformed.target_merchant_ids).toBeNull();
  });

  it('records every rpc call and returns the scenario response', async () => {
    const { calls, client } = makeScheduledNotificationTestClient(async () => ({
      data: true,
      error: null,
    }));

    const result = await client.rpc(FINALIZE, { p_notification_id: 'a' });

    expect(result).toEqual({ data: true, error: null });
    expect(calls).toEqual([
      { args: { p_notification_id: 'a' }, name: FINALIZE },
    ]);
  });

  it('keeps only the finalize calls for the requested notification', async () => {
    const { calls, client } = makeScheduledNotificationTestClient(async () => ({
      data: true,
      error: null,
    }));
    await client.rpc(FINALIZE, { p_notification_id: 'a' });
    await client.rpc(FINALIZE, { p_notification_id: 'b' });
    await client.rpc('other_rpc', { p_notification_id: 'a' });

    expect(finalizeCallsFor(calls, 'a')).toEqual([
      { args: { p_notification_id: 'a' }, name: FINALIZE },
    ]);
  });

  it('loads the delivery worker with its batch entry point', async () => {
    const delivery = await loadScheduledNotificationDelivery();

    expect(typeof delivery.processScheduledNotificationClaims).toBe('function');
  });
});
