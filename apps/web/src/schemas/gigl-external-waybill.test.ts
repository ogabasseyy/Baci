import { describe, expect, it } from 'vitest';
import {
  giglExternalWaybillOrderIdSchema,
  giglExternalWaybillRequestSchema,
} from './gigl-external-waybill';

describe('giglExternalWaybillRequestSchema', () => {
  it('accepts a trimmed waybill for preview and link', () => {
    expect(
      giglExternalWaybillRequestSchema.parse({
        action: 'preview',
        waybill: ' 1349639588 ',
      })
    ).toEqual({ action: 'preview', waybill: '1349639588' });
    expect(
      giglExternalWaybillRequestSchema.safeParse({
        action: 'link',
        waybill: 'GIG-123',
      }).success
    ).toBe(true);
  });

  it('upper-cases a waybill so it matches the duplicate checks', () => {
    expect(
      giglExternalWaybillRequestSchema.parse({
        action: 'link',
        waybill: 'gig-123',
      }).waybill
    ).toBe('GIG-123');
  });

  it.each([
    { action: 'preview', waybill: '' },
    { action: 'preview', waybill: '123' },
    { action: 'preview', waybill: '1349 639588' },
    { action: 'preview', waybill: '1'.repeat(33) },
    { action: 'book', waybill: '1349639588' },
    { action: 'link', waybill: '1349639588', merchantId: 'x' },
  ])('rejects %o', (body) => {
    expect(giglExternalWaybillRequestSchema.safeParse(body).success).toBe(
      false
    );
  });

  it('requires a UUID order id', () => {
    expect(
      giglExternalWaybillOrderIdSchema.safeParse(
        '40000000-0000-4000-8000-000000000001'
      ).success
    ).toBe(true);
    expect(giglExternalWaybillOrderIdSchema.safeParse('ORD-1').success).toBe(
      false
    );
  });
});
