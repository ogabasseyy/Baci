import { describe, expect, it } from 'vitest';
import {
  giglExternalWaybillInputSchema,
  giglExternalWaybillPreviewSchema,
} from './gigl-external-waybill';

describe('giglExternalWaybillInputSchema', () => {
  it('trims a GIG waybill', () => {
    expect(giglExternalWaybillInputSchema.parse(' 1349639588 ')).toBe(
      '1349639588'
    );
  });

  it.each(['', '12', '1349 639588', '#1349639588'])('rejects %j', (value) => {
    expect(giglExternalWaybillInputSchema.safeParse(value).success).toBe(false);
  });
});

describe('giglExternalWaybillPreviewSchema', () => {
  it('accepts a preview without GIG receiver details', () => {
    expect(
      giglExternalWaybillPreviewSchema.safeParse({
        waybill: '1349639588',
        linkable: false,
        match: { name: 'mismatch', phone: 'unknown', destination: 'match' },
        order: { customerName: null, orderNumber: 'ORD-1' },
        gig: null,
      }).success
    ).toBe(true);
  });

  it('rejects an unknown match value', () => {
    expect(
      giglExternalWaybillPreviewSchema.safeParse({
        waybill: '1349639588',
        linkable: true,
        match: { name: 'maybe', phone: 'match', destination: 'match' },
        order: { customerName: null, orderNumber: null },
        gig: null,
      }).success
    ).toBe(false);
  });
});
