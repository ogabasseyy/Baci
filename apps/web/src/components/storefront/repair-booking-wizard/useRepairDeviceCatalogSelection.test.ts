import type { RepairDeviceSummary } from '@baci/shared/repairs';
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import type { StoreProductDeviceSuggestion } from './repair-device-suggestions';
import { useRepairDeviceCatalogSelection } from './useRepairDeviceCatalogSelection';

type RepairFormInput = z.input<typeof repairBookingSchema>;

const repairDevice: RepairDeviceSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  brand: 'Apple',
  model: 'iPhone 15',
  slug: 'iphone-15',
  deviceType: 'Smartphone',
  imageUrl: null,
  productId: null,
};

const storeProduct: StoreProductDeviceSuggestion = {
  kind: 'store-product',
  productId: 'product-1',
  displayName: 'Apple iPad Air',
  deviceType: 'Tablet',
  imageUrl: null,
};

function setup() {
  const hideCatalogConfirmation = vi.fn();
  const hook = renderHook(() => {
    const form = useForm<RepairFormInput, unknown, RepairBookingInput>({
      defaultValues: {
        customerEmail: '',
        customerName: '',
        customerPhone: '',
        deviceModel: '',
        deviceType: 'Smartphone',
        issueDescription: '',
        pickupAddress: '',
        serviceType: 'dropoff',
      },
    });
    const selection = useRepairDeviceCatalogSelection({
      form,
      hideCatalogConfirmation,
    });
    return { form, selection };
  });
  return { ...hook, hideCatalogConfirmation };
}

describe('useRepairDeviceCatalogSelection', () => {
  it('links a catalog device and clears the selected marker when the model is edited', () => {
    const { result } = setup();

    act(() => {
      result.current.form.setValue(
        'quoteId',
        '22222222-2222-4222-8222-222222222222'
      );
      result.current.selection.handleSelectCatalogDevice(repairDevice);
    });

    expect(result.current.form.getValues()).toMatchObject({
      deviceId: repairDevice.id,
      deviceModel: 'Apple iPhone 15',
      deviceType: 'Smartphone',
    });
    expect(result.current.selection.selectedModel).toBe('Apple iPhone 15');

    act(() => result.current.selection.handleDeviceModelChange());

    expect(result.current.form.getValues()).toMatchObject({
      deviceId: undefined,
      deviceModel: 'Apple iPhone 15',
      quoteId: undefined,
    });
    expect(result.current.selection.selectedModel).toBeNull();
  });

  it('clears a catalog model on device-type change but preserves manually entered text', () => {
    const { result } = setup();

    act(() => {
      result.current.form.setValue(
        'quoteId',
        '22222222-2222-4222-8222-222222222222'
      );
      result.current.selection.handleSelectCatalogDevice(repairDevice);
    });
    act(() => result.current.selection.handleDeviceTypeChange());

    expect(result.current.form.getValues()).toMatchObject({
      deviceId: undefined,
      deviceModel: '',
      quoteId: undefined,
    });
    expect(result.current.selection.selectedModel).toBeNull();

    act(() => {
      result.current.form.setValue('deviceModel', 'ThinkPad X1');
      result.current.selection.handleDeviceTypeChange();
    });

    expect(result.current.form.getValues('deviceModel')).toBe('ThinkPad X1');
  });

  it('clears catalog linkage and confirmation when the customer resets the device', () => {
    const { result, hideCatalogConfirmation } = setup();
    act(() => {
      result.current.form.setValue('issueDescription', 'Broken screen');
      result.current.form.setValue('quoteId', 'quote-1');
      result.current.selection.handleSelectCatalogDevice(repairDevice);
    });

    act(() => result.current.selection.handleChangeDevice());

    expect(result.current.form.getValues()).toMatchObject({
      deviceId: undefined,
      deviceModel: '',
      deviceType: 'Smartphone',
      issueDescription: '',
      quoteId: undefined,
    });
    expect(result.current.selection.selectedModel).toBeNull();
    expect(hideCatalogConfirmation).toHaveBeenCalledOnce();
  });

  it('selects a store product without linking repair-catalog IDs', () => {
    const { result } = setup();
    act(() => {
      result.current.form.setValue('deviceId', 'old-device');
      result.current.form.setValue('quoteId', 'old-quote');
      result.current.selection.handleSelectCatalogDevice(storeProduct);
    });

    expect(result.current.form.getValues()).toMatchObject({
      deviceId: undefined,
      deviceModel: 'Apple iPad Air',
      deviceType: 'Tablet',
      quoteId: undefined,
    });
    expect(result.current.selection.selectedModel).toBe('Apple iPad Air');
  });
});
