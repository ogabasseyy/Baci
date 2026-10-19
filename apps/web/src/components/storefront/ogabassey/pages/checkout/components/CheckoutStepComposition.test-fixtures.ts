import { vi } from 'vitest';
import type { CheckoutStepCompositionSession } from './CheckoutStepComposition';

export function createCheckoutStepSession({
  contactComplete = true,
  currentStep = 'contact',
  isDeliveryValid = false,
  signedIn = false,
}: {
  contactComplete?: boolean;
  currentStep?: 'contact' | 'delivery' | 'payment';
  isDeliveryValid?: boolean;
  signedIn?: boolean;
} = {}) {
  const setCurrentStep = vi.fn();
  const setCompletedSteps = vi.fn();
  const setCreateAccount = vi.fn();
  const setPassword = vi.fn();
  const setNewsletterOptIn = vi.fn();
  const session = {
    flow: {
      currentStep,
      completedSteps: { contact: contactComplete, delivery: false },
      focusOnActivate: false,
      signedIn,
      setCurrentStep,
      setCompletedSteps,
    },
    onSignIn: vi.fn(),
    contact: {
      values: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        customerEmail: 'ada@example.test',
        customerPhone: '+2348000000000',
      },
      onChange: vi.fn(),
      onComplete: vi.fn(),
      account: {
        createAccount: false,
        password: '',
        setCreateAccount,
        setPassword,
      },
    },
    delivery: {
      session: {
        address: {
          addresses: [],
          selectedId: 0,
          isNewMode: true,
          setIsNewMode: vi.fn(),
          isNewDeliveryAddressReady: true,
          handlers: {
            onSelectAddress: vi.fn(),
            onStreetChange: vi.fn(),
            onSelectPlace: vi.fn(),
          },
        },
        method: { selected: 'door' },
        options: null,
        validation: { isValid: isDeliveryValid },
      },
      address: {
        street: '1 Main Street',
        city: 'Lagos',
        state: 'Lagos',
        merchantCountry: 'NG',
        isHydrated: true,
      },
    },
    payment: {
      session: {
        tab: 'full',
        method: 'paystack',
        setTab: vi.fn(),
        selectMethod: vi.fn(),
        payForMe: {
          details: { name: '', contact: '', note: '' },
          setDetails: vi.fn(),
        },
        wallet: { remainingAmount: 1_000 },
        total: 1_000,
        redvault: { status: 'idle', summary: null },
      },
      isProcessing: false,
      isPayForMeValid: false,
      isInitializingDva: false,
      newsletterOptIn: false,
      setNewsletterOptIn,
      handlePlaceOrder: vi.fn(),
      merchant: null,
      user: null,
      currency: 'NGN',
      redvaultAvailable: true,
      redvaultOrderReady: false,
    },
  } satisfies CheckoutStepCompositionSession;

  return {
    session,
    setCurrentStep,
    setCompletedSteps,
    setCreateAccount,
    setPassword,
    setNewsletterOptIn,
  };
}
