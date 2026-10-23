'use client';

import { Calendar, CheckCircle, Loader2, MapPin, Truck } from 'lucide-react';
import type { Control } from 'react-hook-form';
import type { z } from 'zod';
import type { ShippingCalculationResult } from '@/app/actions/repair';
import {
  AddressAutocomplete,
  type PlaceDetails,
} from '@/components/address-autocomplete';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';

interface RepairContactStepProps {
  control: Control<
    z.input<typeof repairBookingSchema>,
    unknown,
    RepairBookingInput
  >;
  serviceType?: 'dropoff' | 'pickup' | string;
  shippingQuote: ShippingCalculationResult | null;
  isCalculatingShipping: boolean;
  onAddressSelect: (place: PlaceDetails) => void;
  onRetryShipping?: () => void;
}

/**
 * Step 1 of the repair booking wizard: contact details, drop-off/pickup
 * choice (with a live GIGL shipping estimate for pickup), and an
 * optional preferred date.
 */
export function RepairContactStep({
  control,
  isCalculatingShipping,
  onAddressSelect,
  onRetryShipping = () => undefined,
  serviceType,
  shippingQuote,
}: RepairContactStepProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="customerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="customerPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <PhoneInput
                  defaultCountry="NG"
                  onChange={field.onChange}
                  placeholder="Enter phone number"
                  value={field.value}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="customerEmail"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email Address</FormLabel>
            <FormControl>
              <Input placeholder="john@example.com" type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="serviceType"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">
              How would you like to proceed?
            </FormLabel>
            <FormControl>
              <RadioGroup
                className="grid grid-cols-2 gap-4"
                defaultValue={field.value}
                onValueChange={field.onChange}
              >
                <FormItem>
                  <FormControl>
                    <RadioGroupItem className="peer sr-only" value="dropoff" />
                  </FormControl>
                  <FormLabel
                    className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-store-border bg-store-background p-4 transition-all hover:border-store-primary/50 hover:bg-store-primary/10 has-data-[state=checked]:border-store-primary peer-data-[state=checked]:border-store-primary"
                    style={{
                      borderColor:
                        field.value === 'dropoff'
                          ? 'var(--store-primary)'
                          : undefined,
                    }}
                  >
                    <MapPin className="mb-2 size-6" />
                    <span className="font-medium">Drop-off</span>
                    <span className="text-center text-xs text-store-background-text/70">
                      I'll bring it to you
                    </span>
                  </FormLabel>
                </FormItem>
                <FormItem>
                  <FormControl>
                    <RadioGroupItem className="peer sr-only" value="pickup" />
                  </FormControl>
                  <FormLabel
                    className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-store-border bg-store-background p-4 transition-all hover:border-store-primary/50 hover:bg-store-primary/10 has-data-[state=checked]:border-store-primary peer-data-[state=checked]:border-store-primary"
                    style={{
                      borderColor:
                        field.value === 'pickup'
                          ? 'var(--store-primary)'
                          : undefined,
                    }}
                  >
                    <Truck className="mb-2 size-6" />
                    <span className="font-medium">Pickup</span>
                    <span className="text-center text-xs text-store-background-text/70">
                      Pick up from me
                    </span>
                  </FormLabel>
                </FormItem>
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {serviceType === 'pickup' && (
        <FormField
          control={control}
          name="pickupAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pickup Address</FormLabel>
              <FormControl>
                <AddressAutocomplete
                  country="ng"
                  onChange={field.onChange}
                  onSelect={onAddressSelect}
                  placeholder="Search for your pickup address"
                  showIcon
                  value={field.value}
                />
              </FormControl>
              <FormDescription className="text-xs text-store-background-text/70">
                Select an address suggestion to calculate the GIG Logistics
                pickup fee. Typing an address without selecting a suggestion
                cannot be quoted.
              </FormDescription>
              {isCalculatingShipping && (
                <div className="mt-2 flex items-center text-sm text-store-background-text/70">
                  <Loader2 className="mr-2 size-3 animate-spin" /> Calculating
                  pickup fee…
                </div>
              )}
              {shippingQuote && !isCalculatingShipping && (
                <div
                  className={cn(
                    'mt-2 flex items-center justify-between gap-3 rounded-md border p-2 text-sm font-medium',
                    shippingQuote.error
                      ? 'border-destructive/30 bg-destructive/5 text-destructive'
                      : 'border-store-primary/30 bg-store-primary/5 text-store-background-text'
                  )}
                >
                  <span className="flex items-center">
                    {shippingQuote.isFree ? (
                      <CheckCircle className="mr-2 size-4" />
                    ) : (
                      <Truck className="mr-2 size-4" />
                    )}
                    {shippingQuote.error ||
                      shippingQuote.message ||
                      shippingQuote.formattedPrice}
                  </span>
                  {shippingQuote.error ? (
                    <button
                      className="shrink-0 underline"
                      onClick={onRetryShipping}
                      type="button"
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={control}
        name="preferredDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Preferred Date (Optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  min={new Date().toISOString().slice(0, 16)}
                  type="datetime-local"
                  {...field}
                />
                <Calendar className="pointer-events-none absolute top-2.5 right-3 size-4 text-store-background-text/70" />
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
