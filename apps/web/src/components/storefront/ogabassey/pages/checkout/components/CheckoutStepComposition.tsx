'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { User } from 'lucide-react';
import type { ComponentProps } from 'react';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import type { useCheckoutDeliverySession } from '../hooks/use-checkout-delivery-session';
import type { useCheckoutPaymentSession } from '../hooks/use-checkout-payment-session';
import type { useCheckoutStepState } from '../hooks/use-checkout-step-state';
import { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import { ContactStep } from './ContactStep';
import { PaymentStep } from './PaymentStep';

type CheckoutStepName = ComponentProps<typeof PaymentStep>['currentStep'];
type CompletedSteps = ComponentProps<typeof PaymentStep>['completedSteps'];
type ContactValues = ComponentProps<typeof ContactStep>['values'];
type FullDeliverySession = ReturnType<typeof useCheckoutDeliverySession>;
type DeliverySession = Pick<FullDeliverySession, 'options'> & {
  address: Pick<
    FullDeliverySession['address'],
    | 'addresses'
    | 'isNewDeliveryAddressReady'
    | 'isNewMode'
    | 'selectedId'
    | 'setIsNewMode'
  > & {
    handlers: Pick<
      FullDeliverySession['address']['handlers'],
      'onSelectAddress' | 'onSelectPlace' | 'onStreetChange'
    >;
  };
  method: Pick<FullDeliverySession['method'], 'selected'>;
  validation: Pick<FullDeliverySession['validation'], 'isValid'>;
};
type FullPaymentSession = ReturnType<typeof useCheckoutPaymentSession>;
type PaymentSession = Pick<
  FullPaymentSession,
  'method' | 'selectMethod' | 'setTab' | 'tab' | 'total'
> & {
  payForMe: Pick<FullPaymentSession['payForMe'], 'details' | 'setDetails'>;
  redvault: Pick<FullPaymentSession['redvault'], 'status' | 'summary'>;
  wallet: Pick<FullPaymentSession['wallet'], 'remainingAmount'>;
};
type CheckoutFlowSetters = Pick<
  ReturnType<typeof useCheckoutStepState>,
  'setCurrentStep' | 'setCompletedSteps'
>;

export interface CheckoutStepCompositionSession {
  flow: {
    currentStep: CheckoutStepName;
    completedSteps: CompletedSteps;
    focusOnActivate: boolean;
    signedIn: boolean;
  } & CheckoutFlowSetters;
  onSignIn: () => void;
  contact: {
    values: ContactValues;
    onChange: ComponentProps<typeof ContactStep>['onChange'];
    onComplete: () => void;
    account: {
      createAccount: boolean;
      password: string;
      setCreateAccount: (value: boolean) => void;
      setPassword: (value: string) => void;
    };
  };
  delivery: {
    session: DeliverySession;
    address: {
      street: string;
      city: string;
      state: string;
      merchantCountry: string;
      isHydrated: boolean;
    };
  };
  payment: {
    session: PaymentSession;
    isProcessing: boolean;
    isPayForMeValid: boolean;
    isInitializingDva: boolean;
    newsletterOptIn: boolean;
    setNewsletterOptIn: (value: boolean) => void;
    handlePlaceOrder: ComponentProps<typeof PaymentStep>['handlePlaceOrder'];
    merchant: ComponentProps<typeof PaymentStep>['merchant'];
    user: ComponentProps<typeof PaymentStep>['user'];
    currency: string;
    redvaultAvailable: boolean;
    redvaultOrderReady: boolean;
  };
}

interface CheckoutStepCompositionProps {
  session: CheckoutStepCompositionSession;
}

/** Composes checkout sessions into contact, delivery, and payment step views. */
export function CheckoutStepComposition({
  session,
}: CheckoutStepCompositionProps) {
  const { flow, contact, delivery, payment } = session;
  const { address, method, validation, options } = delivery.session;
  const paymentSession = payment.session;

  function handleDeliveryContinue() {
    captureClientEvent(
      CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
      buildCheckoutFunnelProperties({
        channel: 'web',
        checkoutStep: 'shipping_info',
        source: 'web_checkout',
      })
    );
    flow.setCompletedSteps((previous) => ({ ...previous, delivery: true }));
    flow.setCurrentStep('payment');
  }

  const deliverySummary =
    method.selected === 'door'
      ? `By Road${delivery.address.city ? ` · ${delivery.address.city}` : ''}`
      : method.selected === 'pickup_station'
        ? 'Pickup Station'
        : method.selected === 'pickup'
          ? 'Store Pickup'
          : 'By Air';

  return (
    <div className="lg:col-span-8 space-y-6">
      {!flow.signedIn && flow.currentStep === 'contact' && (
        <div className="bg-store-primary/5 border border-store-primary/20 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-500">
          <div className="flex items-center gap-3">
            <div className="size-10 bg-store-background rounded-xl flex items-center justify-center shadow-sm">
              <User size={20} className="text-store-primary" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-store-background-text">
                Already have an account?
              </h4>
              <p className="text-xs text-store-background-text/65">
                Sign in to use your saved addresses and track orders.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={session.onSignIn}
            className="px-4 py-2 bg-store-background text-store-primary font-bold text-xs rounded-lg border border-store-primary/20 hover:bg-store-primary/5 transition-colors shadow-sm active:scale-95"
          >
            Sign In
          </button>
        </div>
      )}

      <ContactStep
        values={contact.values}
        onChange={contact.onChange}
        account={{
          createAccount: contact.account.createAccount,
          password: contact.account.password,
        }}
        onAccountChange={({ createAccount, password }) => {
          contact.account.setCreateAccount(createAccount);
          contact.account.setPassword(password);
        }}
        onOpen={() => flow.setCurrentStep('contact')}
        onComplete={contact.onComplete}
        active={flow.currentStep === 'contact'}
        completed={flow.completedSteps.contact}
        focusOnActivate={flow.focusOnActivate}
        signedIn={flow.signedIn}
      />

      <CheckoutDeliveryStep
        addressFields={{
          signedIn: flow.signedIn,
          addresses: address.addresses,
          isNewAddressMode: address.isNewMode,
          selectedAddressId: address.selectedId,
          newAddressStreet: delivery.address.street,
          newAddressCity: delivery.address.city,
          newAddressState: delivery.address.state,
          merchantCountry: delivery.address.merchantCountry,
          addressReady:
            delivery.address.isHydrated && address.isNewDeliveryAddressReady,
          onToggleAddressMode: () => address.setIsNewMode(!address.isNewMode),
          onSelectAddress: address.handlers.onSelectAddress,
          onStreetChange: address.handlers.onStreetChange,
          onSelectPlace: address.handlers.onSelectPlace,
        }}
        deliveryOptions={options}
        isDeliveryValid={validation.isValid}
        onContinue={handleDeliveryContinue}
        onOpen={() => flow.setCurrentStep('delivery')}
        summary={deliverySummary}
        active={flow.currentStep === 'delivery'}
        completed={flow.completedSteps.delivery}
        disabled={!flow.completedSteps.contact}
        focusOnActivate={flow.focusOnActivate}
      />

      <PaymentStep
        paymentTab={paymentSession.tab}
        setPaymentTab={paymentSession.setTab}
        paymentMethod={paymentSession.method}
        setPaymentMethod={paymentSession.selectMethod}
        isProcessing={payment.isProcessing}
        isPayForMeValid={payment.isPayForMeValid}
        isDeliveryValid={validation.isValid}
        payForMeDetails={paymentSession.payForMe.details}
        setPayForMeDetails={paymentSession.payForMe.setDetails}
        dva={{ isInitializingDva: payment.isInitializingDva }}
        newsletterOptIn={payment.newsletterOptIn}
        setNewsletterOptIn={payment.setNewsletterOptIn}
        handlePlaceOrder={payment.handlePlaceOrder}
        setCurrentStep={flow.setCurrentStep}
        merchant={payment.merchant}
        user={payment.user}
        remainingAmount={paymentSession.wallet.remainingAmount}
        orderAmount={paymentSession.total}
        currency={payment.currency}
        redvaultAvailable={payment.redvaultAvailable}
        redvaultStatus={paymentSession.redvault.status}
        redvaultSummary={paymentSession.redvault.summary}
        redvaultOrderReady={payment.redvaultOrderReady}
        completedSteps={flow.completedSteps}
        currentStep={flow.currentStep}
        focusOnActivate={flow.focusOnActivate}
      />
    </div>
  );
}
