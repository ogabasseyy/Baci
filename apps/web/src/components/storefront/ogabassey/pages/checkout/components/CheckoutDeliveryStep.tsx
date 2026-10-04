'use client';

import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { CheckoutStepSection } from './CheckoutStepSection';
import { DeliveryAddressFields } from './DeliveryAddressFields';
import { DeliveryOptions } from './DeliveryOptions';

interface CheckoutDeliveryStepProps {
  active: boolean;
  addressFields: ComponentProps<typeof DeliveryAddressFields>;
  completed: boolean;
  deliveryOptions: ComponentProps<typeof DeliveryOptions> | null;
  disabled: boolean;
  focusOnActivate: boolean;
  isDeliveryValid: boolean;
  onContinue: () => void;
  onOpen: () => void;
  summary: string;
}

export function CheckoutDeliveryStep({
  active,
  addressFields,
  completed,
  deliveryOptions,
  disabled,
  focusOnActivate,
  isDeliveryValid,
  onContinue,
  onOpen,
  summary,
}: CheckoutDeliveryStepProps) {
  return (
    <CheckoutStepSection
      active={active}
      completed={completed}
      disabled={disabled}
      focusOnActivate={focusOnActivate}
      id="checkout-delivery"
      number={2}
      onOpen={onOpen}
      summary={summary}
      title="Delivery Method"
    >
      <DeliveryAddressFields {...addressFields} />
      {deliveryOptions && <DeliveryOptions {...deliveryOptions} />}
      <div className="pt-2">
        <button
          className="w-full md:w-auto px-6 py-3 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-store-primary/20 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:shadow-none"
          disabled={!isDeliveryValid}
          onClick={onContinue}
          type="button"
        >
          Continue to Payment <ChevronRight size={18} />
        </button>
      </div>
    </CheckoutStepSection>
  );
}
