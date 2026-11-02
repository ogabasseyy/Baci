import { describe, expect, it, vi } from 'vitest';
import {
  encryptLikeGig,
  GIG_DOC_SAMPLE_BODY,
  GIG_DOC_SAMPLE_CHANNEL_CODE,
  GIG_DOC_SAMPLE_SECRET,
  GIG_DOC_SAMPLE_USER_ID,
} from './gigl-webhook-crypto.test-support';
import { openGiglWebhookDelivery } from './gigl-webhook-delivery';
import { giglWebhookEventJson } from './gigl-webhook-event.test-support';

vi.mock('server-only', () => ({}));

const config = {
  secret: 'test-registration-secret',
  userId: 'a1b2c3d4-0000-4000-8000-000000000001',
  channelCode: 'IND000001',
};

const deliver = (plaintext: string, secret = config.secret) =>
  openGiglWebhookDelivery(encryptLikeGig(plaintext, secret), config);

describe('openGiglWebhookDelivery', () => {
  it("opens GIG's published sample for the account it names", async () => {
    await expect(
      openGiglWebhookDelivery(GIG_DOC_SAMPLE_BODY, {
        secret: GIG_DOC_SAMPLE_SECRET,
        userId: GIG_DOC_SAMPLE_USER_ID,
        channelCode: GIG_DOC_SAMPLE_CHANNEL_CODE,
      })
    ).resolves.toEqual({ ok: true, waybill: '1349104478', statusCode: 'MCRT' });
  });

  it('returns only the waybill and status code, never addresses', async () => {
    const opened = await deliver(giglWebhookEventJson());

    expect(opened).toEqual({
      ok: true,
      waybill: '1349639673',
      statusCode: 'MCRT',
    });
    expect(JSON.stringify(opened)).not.toMatch(/Street|Road/);
  });

  it('matches the account case-insensitively', async () => {
    await expect(
      deliver(
        giglWebhookEventJson({
          UserId: config.userId.toUpperCase(),
          ChannelCode: 'ind000001',
        })
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it('accepts a numeric waybill and a missing status code', async () => {
    await expect(
      deliver(giglWebhookEventJson({ Waybill: 1349639673, StatusCode: null }))
    ).resolves.toEqual({ ok: true, waybill: '1349639673', statusCode: null });
  });

  it('rejects a body that is not GIG framing', async () => {
    await expect(
      openGiglWebhookDelivery('{"Waybill":"1349639673"}', config)
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a delivery encrypted with another secret', async () => {
    await expect(
      deliver(giglWebhookEventJson(), 'attacker-secret')
    ).resolves.toEqual({ ok: false, reason: 'undecryptable' });
  });

  it('rejects decrypted text that is not JSON', async () => {
    await expect(deliver('not json')).resolves.toEqual({
      ok: false,
      reason: 'invalid_event',
    });
  });

  it.each([
    ['a missing waybill', { Waybill: undefined }],
    ['a waybill with spaces', { Waybill: '1349 639673' }],
    ['a missing user id', { UserId: '' }],
    ['a missing channel code', { ChannelCode: undefined }],
  ])('rejects an event with %s', async (_label, overrides) => {
    await expect(deliver(giglWebhookEventJson(overrides))).resolves.toEqual({
      ok: false,
      reason: 'invalid_event',
    });
  });

  it.each([
    ['user id', { UserId: 'a1b2c3d4-0000-4000-8000-000000000999' }],
    ['channel code', { ChannelCode: 'IND999999' }],
  ])('rejects a delivery for another GIG %s', async (_label, overrides) => {
    await expect(deliver(giglWebhookEventJson(overrides))).resolves.toEqual({
      ok: false,
      reason: 'foreign_account',
    });
  });
});
