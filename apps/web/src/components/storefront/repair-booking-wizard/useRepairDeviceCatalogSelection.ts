'use client';

import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import { getRepairDeviceSuggestionLabel } from './repair-device-suggestion-label';
import type { RepairDeviceSelection } from './repair-device-suggestions';

type RepairBookingForm = UseFormReturn<
  z.input<typeof repairBookingSchema>,
  unknown,
  RepairBookingInput
>;

interface UseRepairDeviceCatalogSelectionOptions {
  form: RepairBookingForm;
  hideCatalogConfirmation: () => void;
}

export function useRepairDeviceCatalogSelection({
  form,
  hideCatalogConfirmation,
}: UseRepairDeviceCatalogSelectionOptions) {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const handleChangeDevice = () => {
    setSelectedModel(null);
    hideCatalogConfirmation();
    form.setValue('deviceId', undefined);
    form.setValue('quoteId', undefined);
    form.setValue('deviceType', 'Smartphone');
    form.setValue('deviceModel', '');
    form.setValue('issueDescription', '');
  };

  const handleSelectCatalogDevice = (device: RepairDeviceSelection) => {
    setSelectedModel(getRepairDeviceSuggestionLabel(device));
    if ('kind' in device) {
      form.setValue('deviceId', undefined, { shouldDirty: true });
      form.setValue('quoteId', undefined, { shouldDirty: true });
      form.setValue('deviceType', device.deviceType, { shouldDirty: true });
      form.setValue('deviceModel', device.displayName, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    form.setValue('deviceId', device.id, { shouldDirty: true });
    form.setValue(
      'deviceType',
      device.deviceType ?? form.getValues('deviceType'),
      { shouldDirty: true }
    );
    form.setValue('deviceModel', `${device.brand} ${device.model}`.trim(), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleDeviceModelChange = () => {
    setSelectedModel(null);
    form.setValue('deviceId', undefined, { shouldDirty: true });
    form.setValue('quoteId', undefined, { shouldDirty: true });
  };

  const handleDeviceTypeChange = () => {
    const hadCatalogSelection = selectedModel !== null;
    handleDeviceModelChange();
    if (hadCatalogSelection) {
      form.setValue('deviceModel', '', {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  return {
    handleChangeDevice,
    handleDeviceModelChange,
    handleDeviceTypeChange,
    handleSelectCatalogDevice,
    selectedModel,
  };
}
