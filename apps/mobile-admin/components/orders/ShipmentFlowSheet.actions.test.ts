import { describe, expect, it } from 'vitest';
import {
  getShipmentFlowPrimaryActionLabel,
  isShipmentFlowPrimaryDisabled,
} from './ShipmentFlowSheet.actions';

const labelInput = {
  detailStepCount: 2,
  fulfillmentItemIndex: 0,
  hasGiglQuote: false,
  providerLabel: null,
  selectedMode: 'provider' as const,
  step: 'method' as const,
};

function waybill(state: string, linkable?: boolean) {
  return {
    state,
    preview: linkable === undefined ? null : { linkable },
  } as never;
}

describe('getShipmentFlowPrimaryActionLabel', () => {
  it('keeps the existing labels', () => {
    expect(
      getShipmentFlowPrimaryActionLabel({ ...labelInput, step: 'details' })
    ).toBe('Next Item');
    expect(
      getShipmentFlowPrimaryActionLabel({
        ...labelInput,
        fulfillmentItemIndex: 1,
        step: 'details',
      })
    ).toBe('Continue');
    expect(
      getShipmentFlowPrimaryActionLabel({ ...labelInput, hasGiglQuote: true })
    ).toBe('Book with GIG Logistics');
    expect(
      getShipmentFlowPrimaryActionLabel({
        ...labelInput,
        selectedMode: 'self_fulfillment',
      })
    ).toBe('Continue to Rider');
    expect(
      getShipmentFlowPrimaryActionLabel({ ...labelInput, step: 'rider' })
    ).toBe('Mark Shipped');
  });

  it('checks a typed waybill before attaching it', () => {
    const input = { ...labelInput, selectedMode: 'external_waybill' as const };
    expect(getShipmentFlowPrimaryActionLabel(input)).toBe('Check Waybill');
    expect(
      getShipmentFlowPrimaryActionLabel({
        ...input,
        externalWaybill: waybill('preview', true),
      })
    ).toBe('Attach Waybill');
  });
});

describe('isShipmentFlowPrimaryDisabled', () => {
  const base = {
    canBookGigl: true,
    canUseProvider: true,
    isRecoveryBlocking: false,
    selectedMode: 'external_waybill' as const,
    step: 'method' as const,
  };

  it('enables checking and attaching only when it can proceed', () => {
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        externalWaybill: waybill('idle'),
      })
    ).toBe(false);
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        externalWaybill: waybill('preview', true),
      })
    ).toBe(false);
    for (const state of [waybill('checking'), waybill('linking')]) {
      expect(
        isShipmentFlowPrimaryDisabled({ ...base, externalWaybill: state })
      ).toBe(true);
    }
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        externalWaybill: waybill('preview', false),
      })
    ).toBe(true);
    expect(isShipmentFlowPrimaryDisabled(base)).toBe(true);
  });

  it('keeps the provider and recovery rules', () => {
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        canUseProvider: false,
        selectedMode: 'provider',
      })
    ).toBe(true);
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        selectedMode: 'self_fulfillment',
      })
    ).toBe(false);
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        isRecoveryBlocking: true,
        selectedMode: 'self_fulfillment',
      })
    ).toBe(true);
  });

  it('gates wallet booking on GIG booking rights but not the waybill link', () => {
    const wallet = {
      state: 'ready',
      wallet: { canBook: true },
    } as never;
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        canBookGigl: false,
        giglShipping: wallet,
        selectedMode: 'provider',
      })
    ).toBe(true);
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        canBookGigl: true,
        giglShipping: wallet,
        selectedMode: 'provider',
      })
    ).toBe(false);
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        canBookGigl: false,
        externalWaybill: waybill('preview', true),
      })
    ).toBe(false);
  });

  it('keeps a saved non-GIG quote bookable without GIG booking rights', () => {
    expect(
      isShipmentFlowPrimaryDisabled({
        ...base,
        canBookGigl: false,
        canUseProvider: true,
        giglShipping: undefined,
        selectedMode: 'provider',
      })
    ).toBe(false);
  });
});
