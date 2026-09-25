import { describe, expect, it } from 'vitest';
import {
  JumiaCancelResponseSchema,
  JumiaPackV2ResponseSchema,
  JumiaPrintLabelsResponseSchema,
  JumiaReadyToShipResponseSchema,
} from './fulfillment';

describe('fulfillment v7 contracts', () => {
  it('preserves ready countryCode', () => {
    expect(
      JumiaReadyToShipResponseSchema.safeParse({
        success: {
          packages: [
            {
              orderItems: ['ITEM-1'],
              trackingNumber: 'TRACK-1',
              countryCode: 'NG',
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
  });
  it('preserves cancel countryCode', () => {
    expect(
      JumiaCancelResponseSchema.safeParse({
        success: {
          orderItems: [
            {
              id: 'ITEM-1',
              countryCode: 'NG',
              cancellationReason: { id: 'R', description: 'x' },
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
  });
  it('uses print orderItemIds and accepts base64, PDF data, or HTTP(S) labels', () => {
    expect(
      JumiaPrintLabelsResponseSchema.safeParse({
        success: {
          labels: [
            {
              orderItemIds: ['ITEM-1'],
              trackingNumber: 'TRACK-1',
              countryCode: 'NG',
              label: 'bGFiZWw=',
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
    expect(
      JumiaPrintLabelsResponseSchema.safeParse({
        success: {
          labels: [
            {
              orderItemIds: ['ITEM-1'],
              trackingNumber: 'TRACK-1',
              countryCode: 'NG',
              label: 'https://labels.jumia.com/x',
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
    expect(
      JumiaPrintLabelsResponseSchema.safeParse({
        success: {
          labels: [
            {
              orderItemIds: ['ITEM-1'],
              trackingNumber: 'TRACK-1',
              countryCode: 'NG',
              label: 'data:application/pdf;base64,UERG',
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
  });
  it('uses trackingCode on pack', () => {
    expect(
      JumiaPackV2ResponseSchema.safeParse({
        success: {
          packages: [
            {
              orderItems: ['ITEM-1'],
              trackingCode: 'TRACK-1',
              countryCode: 'NG',
            },
          ],
          total: 1,
        },
      }).success
    ).toBe(true);
  });
});
