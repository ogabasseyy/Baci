import { describe, expect, it } from 'vitest';
import { scheduledNotificationWorker } from './scheduled-notification-worker';

const {
  getExpoTicketFailure,
  nextRecipientPageCursor,
  parseClaimedNotification,
  parseMalformedClaimIdentity,
} = scheduledNotificationWorker;

describe('scheduled notification worker helpers', () => {
  it('progresses through more than 10,000 recipients in bounded pages', () => {
    const pageSize = 500;
    let cursor: string | null = null;
    for (let page = 0; page < 21; page += 1) {
      const size = page === 20 ? 1 : pageSize;
      const ids = Array.from(
        { length: size },
        (_, index) =>
          `${page.toString().padStart(2, '0')}-${index.toString().padStart(3, '0')}`
      );
      cursor = nextRecipientPageCursor(ids, pageSize);
      expect(cursor).toBe(page === 20 ? null : ids.at(-1));
    }
  });

  it('rejects a claimed record without a recipient array', () => {
    expect(() =>
      parseClaimedNotification({
        id: '123e4567-e89b-42d3-a456-426614174001',
        delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
        title: 'Update',
        message: 'Message',
        target_type: 'all',
        target_merchant_ids: null,
        target_segment: null,
        channels: ['in_app'],
        action_url: null,
        expires_at: null,
      })
    ).toThrow('malformed scheduled notification');
  });

  it('extracts claim identity from malformed legacy rows', () => {
    expect(
      parseMalformedClaimIdentity({
        id: '123e4567-e89b-42d3-a456-426614174001',
        delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
        title: '',
      })
    ).toEqual({
      id: '123e4567-e89b-42d3-a456-426614174001',
      delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
    });
    expect(parseMalformedClaimIdentity({ id: 'not-a-uuid' })).toBeNull();
  });

  it('turns an Expo ticket error into a retryable failure', () => {
    expect(
      getExpoTicketFailure(
        {
          data: [
            {
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
              message: 'provider payload that must not be persisted',
            },
          ],
        },
        1
      )
    ).toContain('DeviceNotRegistered');
    expect(
      getExpoTicketFailure(
        {
          data: [
            {
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
              message: 'provider payload that must not be persisted',
            },
          ],
        },
        1
      )
    ).not.toContain('provider payload');
  });

  it('rejects a claimed record without its lease token', () => {
    expect(() =>
      parseClaimedNotification({
        id: '123e4567-e89b-42d3-a456-426614174001',
        title: 'Update',
        message: 'Message',
        target_type: 'all',
        target_merchant_ids: [],
        target_segment: null,
        channels: ['in_app'],
        action_url: null,
        expires_at: null,
      })
    ).toThrow('malformed scheduled notification');
  });

  it('accepts a bounded, internally consistent claimed notification', () => {
    expect(
      parseClaimedNotification({
        action_url: 'https://usebaci.com/dashboard',
        channels: ['in_app', 'push'],
        delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
        expires_at: '2026-08-06T12:00:00.000Z',
        id: '123e4567-e89b-42d3-a456-426614174001',
        message: 'Message',
        target_merchant_ids: [],
        target_segment: 'active',
        target_type: 'segment',
        title: 'Update',
      })
    ).toMatchObject({ target_segment: 'active', target_type: 'segment' });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,alert(1)',
    'http://example.com',
    '//example.com',
    '/\\example.com',
    'https://example.com/\u0000payload',
  ])('rejects unsafe legacy action URL %j before it reaches Expo', (action_url) => {
    expect(() =>
      parseClaimedNotification({
        action_url,
        channels: ['push'],
        delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
        expires_at: null,
        id: '123e4567-e89b-42d3-a456-426614174001',
        message: 'Message',
        target_merchant_ids: [],
        target_segment: null,
        target_type: 'all',
        title: 'Update',
      })
    ).toThrow('malformed scheduled notification');
  });

  it.each([
    { channels: ['email'] },
    { expires_at: 'not-a-date' },
    { target_merchant_ids: [], target_segment: null, target_type: 'specific' },
  ])('rejects malformed delivery contracts: %o', (override) => {
    expect(() =>
      parseClaimedNotification({
        action_url: null,
        channels: ['in_app'],
        delivery_claim_token: '123e4567-e89b-42d3-a456-426614174002',
        expires_at: null,
        id: '123e4567-e89b-42d3-a456-426614174001',
        message: 'Message',
        target_merchant_ids: [],
        target_segment: null,
        target_type: 'all',
        title: 'Update',
        ...override,
      })
    ).toThrow('malformed scheduled notification');
  });
});
