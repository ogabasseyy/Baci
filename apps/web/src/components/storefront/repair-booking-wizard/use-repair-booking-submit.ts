import { useState } from 'react';
import type { ShippingCalculationResult } from '@/app/actions/repair';
import { createRepair } from '@/app/actions/repair';
import { startCustomerRepairPickupPayment } from '@/app/actions/repair-pickup-payment';
import type { RepairBookingInput } from '@/lib/validations/repair';

interface UseRepairBookingSubmitOptions {
  applyShippingQuote: (quote: ShippingCalculationResult) => void;
  merchantId: string;
  merchantSlug: string;
  onPickupPaymentReady: (payment: {
    amount: number;
    authorizationUrl: string;
    ticketNumber: number;
  }) => void;
  onSuccess: (ticketNumber: number) => void;
  setCurrentStep: (step: number) => void;
  shippingQuote: ShippingCalculationResult | null;
  toast: (options: {
    description: string;
    title: string;
    variant?: 'destructive';
  }) => void;
}

export function useRepairBookingSubmit({
  applyShippingQuote,
  merchantId,
  merchantSlug,
  onPickupPaymentReady,
  onSuccess,
  setCurrentStep,
  shippingQuote,
  toast,
}: UseRepairBookingSubmitOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickupResumeToken, setPickupResumeToken] = useState<string | null>(
    null
  );

  const onSubmit = (data: RepairBookingInput) => {
    setIsSubmitting(true);
    const operation =
      data.serviceType === 'pickup' && shippingQuote?.price
        ? startCustomerRepairPickupPayment(
            data,
            shippingQuote.price,
            merchantId,
            merchantSlug,
            pickupResumeToken
          )
        : createRepair(data, merchantId);

    return operation
      .then((result) => {
        if (result.success) {
          if ('payment' in result) {
            if (
              'resumeToken' in result &&
              typeof result.resumeToken === 'string'
            ) {
              setPickupResumeToken(result.resumeToken);
            }
            onPickupPaymentReady({
              ...result.payment,
              ticketNumber: result.ticketNumber,
            });
            return;
          }
          onSuccess(result.ticketNumber);
          toast({
            description:
              'We have received your repair request. We will contact you shortly.',
            title: 'Request Submitted',
          });
          return;
        }

        if (
          'resumeToken' in result &&
          typeof result.resumeToken === 'string' &&
          result.resumeToken.length > 0
        ) {
          setPickupResumeToken(result.resumeToken);
        }

        if (result.code === 'resume_invalid') {
          setPickupResumeToken(null);
        }

        if (result.code === 'payment_initialization_failed') {
          const ticketSuffix =
            typeof result.ticketNumber === 'number'
              ? ` Ticket #${result.ticketNumber}.`
              : '';
          toast({
            description: `${result.error}${ticketSuffix}`,
            title: 'Submission Failed',
            variant: 'destructive',
          });
          return;
        }

        if (result.code === 'quote_changed' && result.quote) {
          applyShippingQuote({
            formattedPrice: result.quote.formattedPrice,
            isFree: false,
            message: `Estimated pickup fee: ${result.quote.formattedPrice}`,
            price: result.quote.price,
          });
          setCurrentStep(1);
        }

        toast({
          description: result.error,
          title: 'Submission Failed',
          variant: 'destructive',
        });
      })
      .catch(() => {
        toast({
          description: 'Something went wrong. Please try again.',
          title: 'Error',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return { isSubmitting, onSubmit };
}
