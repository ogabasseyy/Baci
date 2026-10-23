'use client';

import type { Control } from 'react-hook-form';
import type { z } from 'zod';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import { RepairDeviceModelField } from './RepairDeviceModelField';
import {
  REPAIR_DEVICE_TYPE_OPTIONS,
  type RepairBookingPreselection,
} from './repair-booking-wizard-constants';
import type { RepairDeviceSelection } from './repair-device-suggestions';

interface RepairDeviceStepProps {
  control: Control<
    z.input<typeof repairBookingSchema>,
    unknown,
    RepairBookingInput
  >;
  catalogEnabled?: boolean;
  repairCatalogEnabled?: boolean;
  merchantId?: string;
  merchantSlug?: string;
  onDeviceChange?: () => void;
  onDeviceTypeChange?: () => void;
  onSelectDevice?: (device: RepairDeviceSelection) => void;
  preselection?: RepairBookingPreselection;
  showConfirmation: boolean;
  onChangeDevice: () => void;
}

function formatQuotePrice(preselection: RepairBookingPreselection) {
  if (preselection.quotePrice == null) {
    return null;
  }
  const prefix = preselection.isFromPrice === false ? '' : 'From ';
  return `${prefix}₦${preselection.quotePrice.toLocaleString()}`;
}

/**
 * Step 0 of the repair booking wizard. When a catalogue device/quote was
 * preselected (via `/[slug]/repair?device=&quote=`) this renders a
 * confirmation panel instead of the free-text device form, with an escape
 * hatch back to free text for "my device isn't listed".
 */
export function RepairDeviceStep({
  control,
  catalogEnabled = false,
  repairCatalogEnabled = catalogEnabled,
  merchantId,
  merchantSlug = '',
  onDeviceChange = () => undefined,
  onDeviceTypeChange = onDeviceChange,
  onSelectDevice = () => undefined,
  onChangeDevice,
  preselection,
  showConfirmation,
}: RepairDeviceStepProps) {
  if (showConfirmation && preselection) {
    const priceLabel = formatQuotePrice(preselection);

    return (
      <div className="space-y-6">
        <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-5">
          <p className="text-sm text-muted-foreground">Selected device</p>
          <p className="text-lg font-semibold">{preselection.deviceLabel}</p>
          {preselection.quoteLabel && (
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="font-medium">{preselection.quoteLabel}</span>
              {priceLabel && (
                <span className="font-bold text-primary">{priceLabel}</span>
              )}
            </div>
          )}
          <button
            className="mt-4 text-sm font-medium text-primary underline-offset-2 hover:underline"
            onClick={onChangeDevice}
            type="button"
          >
            Not this device? Describe your repair instead
          </button>
        </div>

        <FormField
          control={control}
          name="issueDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Anything else we should know?</FormLabel>
              <FormControl>
                <Textarea
                  className="min-h-[100px]"
                  placeholder="Add any extra detail about the issue (optional but helpful)"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name="deviceType"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">
              What device needs repair?
            </FormLabel>
            <FormControl>
              <RadioGroup
                className="grid grid-cols-2 gap-4 sm:grid-cols-3"
                onValueChange={(value) => {
                  if (value !== field.value) {
                    onDeviceTypeChange();
                  }
                  field.onChange(value);
                }}
                value={field.value}
              >
                {REPAIR_DEVICE_TYPE_OPTIONS.map((type) => (
                  <FormItem key={type.id}>
                    <FormControl>
                      <RadioGroupItem
                        className="peer sr-only"
                        value={type.id}
                      />
                    </FormControl>
                    <FormLabel className="flex cursor-pointer flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 transition-all hover:bg-accent hover:text-accent-foreground has-data-[state=checked]:border-primary peer-data-[state=checked]:border-primary">
                      <type.icon className="mb-3 size-6" />
                      {type.label}
                    </FormLabel>
                  </FormItem>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="deviceModel"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Device Model</FormLabel>
            <FormControl>
              <RepairDeviceModelField
                catalogEnabled={catalogEnabled}
                field={field}
                merchantId={merchantId}
                merchantSlug={merchantSlug}
                repairCatalogEnabled={repairCatalogEnabled}
                onDeviceChange={onDeviceChange}
                onSelectDevice={onSelectDevice}
              />
            </FormControl>
            {catalogEnabled && (
              <p className="text-xs text-muted-foreground">
                Search repairable devices and matching store products. You can
                still enter a model that is not listed.
              </p>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="issueDescription"
        render={({ field }) => (
          <FormItem>
            <FormLabel>What's the issue?</FormLabel>
            <FormControl>
              <Textarea
                className="min-h-[100px]"
                placeholder="Please describe the problem (e.g. Broken screen, Battery not charging)"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
