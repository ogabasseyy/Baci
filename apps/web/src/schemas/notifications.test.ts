import { describe, expect, it } from 'vitest';
import {
  adminNotificationListQuerySchema,
  createNotificationSchema,
  dateTimeLocalToUtcIso,
  notificationIdSchema,
  updateMerchantNotificationSchema,
  updateNotificationSchema,
} from './notifications';

const validCreateNotification = {
  title: 'Inventory update',
  message: 'New stock is available.',
  channels: ['in_app'],
} as const;

describe('notification schemas', () => {
  it('accepts trimmed HTTPS action URLs using the Zod 4 URL validator', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      action_url: '  https://usebaci.com/dashboard/orders  ',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.action_url).toBe(
        'https://usebaci.com/dashboard/orders'
      );
    }
  });

  it('trims a maximum-length same-site action URL before enforcing its limit', () => {
    const action_url = `  /${'a'.repeat(2047)}  `;
    const parsed = updateNotificationSchema.safeParse({ action_url });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.action_url).toHaveLength(2048);
    }
  });

  it('accepts an explicit same-site relative action URL', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      action_url: '/dashboard/orders?tab=open',
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    'not-a-url',
    'javascript:alert(1)',
    'data:text/html,alert(1)',
    'http://example.com',
    '//example.com',
    '/\\example.com',
    'https://example.com/\u0000payload',
  ])('rejects unsafe action URL %j on create and update', (action_url) => {
    expect(
      createNotificationSchema.safeParse({
        ...validCreateNotification,
        action_url,
      }).success
    ).toBe(false);
    expect(updateNotificationSchema.safeParse({ action_url }).success).toBe(
      false
    );
  });

  it('rejects oversized or unknown notification fields', () => {
    expect(
      createNotificationSchema.safeParse({
        ...validCreateNotification,
        message: 'x'.repeat(5001),
      }).success
    ).toBe(false);
    expect(
      createNotificationSchema.safeParse({
        ...validCreateNotification,
        unreviewed_delivery_mode: true,
      }).success
    ).toBe(false);
  });

  it('allows update payloads to clear merchant ID targeting with null', () => {
    const parsed = updateNotificationSchema.safeParse({
      target_merchant_ids: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.target_merchant_ids).toBeNull();
    }
  });

  it('rejects clearing a scheduled delivery time through PATCH', () => {
    expect(
      updateNotificationSchema.safeParse({ scheduled_for: null }).success
    ).toBe(false);
  });

  it('rejects a no-op admin notification update', () => {
    expect(updateNotificationSchema.safeParse({}).success).toBe(false);
  });

  it('strictly validates recipient notification state changes', () => {
    expect(notificationIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(
      updateMerchantNotificationSchema.safeParse({ read: false }).success
    ).toBe(true);
    expect(updateMerchantNotificationSchema.safeParse({}).success).toBe(false);
    expect(
      updateMerchantNotificationSchema.safeParse({ dismissed: false }).success
    ).toBe(false);
    expect(
      updateMerchantNotificationSchema.safeParse({ read: true, injected: true })
        .success
    ).toBe(false);
  });

  it('requires merchant IDs for specific create targeting', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      target_type: 'specific',
      target_merchant_ids: [],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.target_merchant_ids).toContain(
        'Target merchant IDs required for specific targeting'
      );
    }
  });

  it('requires a segment for segment create targeting', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      target_type: 'segment',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.target_segment).toContain(
        'Target segment required for segment targeting'
      );
    }
  });

  it('accepts valid targeted create notifications', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      target_type: 'specific',
      target_merchant_ids: ['123e4567-e89b-12d3-a456-426614174000'],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate specific merchant IDs in create and PATCH targeting', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(
      createNotificationSchema.safeParse({
        ...validCreateNotification,
        target_type: 'specific',
        target_merchant_ids: [id, id],
      }).success
    ).toBe(false);
    expect(
      updateNotificationSchema.safeParse({
        target_type: 'specific',
        target_merchant_ids: [id, id],
      }).success
    ).toBe(false);
  });

  it('rejects a create expiry that is not after its effective send time', () => {
    const parsed = createNotificationSchema.safeParse({
      ...validCreateNotification,
      expires_at: '2099-01-01T00:00:00.000Z',
      scheduled_for: '2099-01-01T00:00:00.000Z',
    });

    expect(parsed.success).toBe(false);
  });

  it('converts a datetime-local value to an explicit UTC ISO instant', () => {
    const value = '2026-08-05T00:30';

    expect(dateTimeLocalToUtcIso(value)).toBe(new Date(value).toISOString());
    expect(dateTimeLocalToUtcIso(value)).toMatch(/Z$/);
  });

  it('rejects datetime values without the datetime-local shape', () => {
    expect(() => dateTimeLocalToUtcIso('2026-08-05T00:30:00Z')).toThrow(
      'Invalid local datetime'
    );
  });

  it('rejects a calendar date that JavaScript would otherwise normalize', () => {
    expect(() => dateTimeLocalToUtcIso('2026-02-30T00:30')).toThrow(
      'Invalid local datetime'
    );
  });

  it('accepts durable lifecycle filters and rejects the removed draft state', () => {
    expect(
      adminNotificationListQuerySchema.safeParse({ status: 'queued' }).success
    ).toBe(true);
    expect(
      adminNotificationListQuerySchema.safeParse({ status: 'failed' }).success
    ).toBe(true);
    expect(
      adminNotificationListQuerySchema.safeParse({ status: 'draft' }).success
    ).toBe(false);
  });
});
