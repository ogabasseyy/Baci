'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import {
  type RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import { RepairBookingSuccess } from './repair-booking-wizard/RepairBookingSuccess';
import { RepairContactStep } from './repair-booking-wizard/RepairContactStep';
import { RepairDeviceStep } from './repair-booking-wizard/RepairDeviceStep';
import { RepairPickupPaymentReady } from './repair-booking-wizard/RepairPickupPaymentReady';
import { RepairReviewStep } from './repair-booking-wizard/RepairReviewStep';
import { RepairWizardProgressBar } from './repair-booking-wizard/RepairWizardProgressBar';
import {
  buildRepairWizardDefaultValues,
  REPAIR_WIZARD_STEPS,
  type RepairBookingPreselection,
} from './repair-booking-wizard/repair-booking-wizard-constants';
import { useRepairBookingSubmit } from './repair-booking-wizard/use-repair-booking-submit';
import { useRepairShippingQuote } from './repair-booking-wizard/use-repair-shipping-quote';

export type { RepairBookingPreselection };

interface RepairBookingWizardProps {
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  preselection?: RepairBookingPreselection;
}

export function RepairBookingWizard({
  merchantId,
  merchantSlug,
  merchantName,
  preselection,
}: RepairBookingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [pickupPayment, setPickupPayment] = useState<{
    amount: number;
    authorizationUrl: string;
    ticketNumber: number;
  } | null>(null);
  const [showCatalogConfirmation, setShowCatalogConfirmation] = useState(
    Boolean(preselection)
  );
  const { toast } = useToast();
  const {
    applyShippingQuote,
    isCalculatingShipping,
    retry: retryShippingQuote,
    selectAddress: handleAddressSelect,
    shippingQuote,
  } = useRepairShippingQuote(merchantSlug);

  const { isSubmitting, onSubmit } = useRepairBookingSubmit({
    applyShippingQuote,
    merchantId,
    merchantSlug,
    onPickupPaymentReady: setPickupPayment,
    onSuccess: (nextTicketNumber) => {
      setTicketNumber(nextTicketNumber);
      setIsSuccess(true);
    },
    setCurrentStep,
    shippingQuote,
    toast,
  });

  const form = useForm<
    z.input<typeof repairBookingSchema>,
    unknown,
    RepairBookingInput
  >({
    defaultValues: buildRepairWizardDefaultValues(preselection),
    mode: 'onTouched',
    resolver: zodResolver(repairBookingSchema),
  });

  const { control, trigger } = form;
  const formData = useWatch({ control });

  const handleChangeDevice = () => {
    setShowCatalogConfirmation(false);
    form.setValue('deviceId', undefined);
    form.setValue('quoteId', undefined);
    form.setValue('deviceType', 'Smartphone');
    form.setValue('deviceModel', '');
    form.setValue('issueDescription', '');
  };

  const nextStep = async () => {
    let fieldsToValidate: (keyof RepairBookingInput)[] = [];
    if (currentStep === 0) {
      fieldsToValidate = ['deviceType', 'deviceModel', 'issueDescription'];
    } else if (currentStep === 1) {
      fieldsToValidate = [
        'customerName',
        'customerEmail',
        'customerPhone',
        'preferredDate',
        'serviceType',
        'pickupAddress',
      ];
    }

    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    setCurrentStep((prev) => prev - 1);
  };

  if (pickupPayment) {
    return <RepairPickupPaymentReady {...pickupPayment} />;
  }

  if (isSuccess) {
    return (
      <RepairBookingSuccess
        merchantName={merchantName}
        ticketNumber={ticketNumber}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <RepairWizardProgressBar currentStep={currentStep} />

      {/* biome-ignore lint/suspicious/noExplicitAny: Workaround for react-hook-form/zod generic mismatch */}
      <Form {...(form as any)}>
        <form className="space-y-8" onSubmit={form.handleSubmit(onSubmit)}>
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                initial={{ opacity: 0, x: 20 }}
                key="step-0"
                transition={{ duration: 0.3 }}
              >
                <RepairDeviceStep
                  control={control}
                  onChangeDevice={handleChangeDevice}
                  preselection={preselection}
                  showConfirmation={showCatalogConfirmation}
                />
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                initial={{ opacity: 0, x: 20 }}
                key="step-1"
                transition={{ duration: 0.3 }}
              >
                <RepairContactStep
                  control={control}
                  isCalculatingShipping={isCalculatingShipping}
                  onAddressSelect={(place) => {
                    form.setValue('pickupAddress', place.formattedAddress);
                    handleAddressSelect(place);
                  }}
                  onRetryShipping={retryShippingQuote}
                  serviceType={formData.serviceType}
                  shippingQuote={shippingQuote}
                />
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                initial={{ opacity: 0, x: 20 }}
                key="step-2"
                transition={{ duration: 0.3 }}
              >
                <RepairReviewStep
                  formData={formData}
                  shippingQuote={shippingQuote}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex justify-between border-t pt-6">
            <Button
              className={currentStep === 0 ? 'invisible' : ''}
              disabled={currentStep === 0 || isSubmitting}
              onClick={prevStep}
              type="button"
              variant="outline"
            >
              <ChevronLeft className="mr-2 size-4" /> Back
            </Button>

            {currentStep < REPAIR_WIZARD_STEPS.length - 1 ? (
              <button
                className="inline-flex items-center rounded-md px-6 py-2.5 font-medium text-white transition-colors"
                onClick={nextStep}
                style={{ backgroundColor: 'var(--theme-primary, #dc2626)' }}
                type="button"
              >
                Next <ChevronRight className="ml-2 size-4" />
              </button>
            ) : (
              <button
                className="inline-flex items-center rounded-md px-6 py-2.5 font-medium text-white transition-colors disabled:opacity-50"
                disabled={
                  isSubmitting ||
                  (formData.serviceType === 'pickup' &&
                    (!shippingQuote?.price || Boolean(shippingQuote.error)))
                }
                style={{ backgroundColor: 'var(--theme-primary, #dc2626)' }}
                type="submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Submitting…
                  </>
                ) : formData.serviceType === 'pickup' ? (
                  'Continue to payment'
                ) : (
                  'Book Appointment'
                )}
              </button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
