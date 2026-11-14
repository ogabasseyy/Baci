'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Data } from '@puckeditor/core';
import type { User } from '@supabase/supabase-js';
import { AlertCircle, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import {
  type ServerActionState,
  submitOnboarding,
} from '@/app/(platform)/onboarding/actions';
import {
  trackMerchantSignupCompleted,
  trackMerchantSignupStarted,
} from '@/components/analytics/platform-analytics-provider';
import { Logo } from '@/components/logo';
// Steps - Static import for instant transition (Better INP/UX)
import Step1_BusinessDetails from '@/components/onboarding/steps/step1-business-details';
import Step2_Branding from '@/components/onboarding/steps/step2-branding';
import Step3_Account from '@/components/onboarding/steps/step3-account';
import { BagLoader } from '@/components/ui/bag-loader';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { isImeComposing } from '@/lib/is-ime-composing';
import { createClient } from '@/lib/supabase/client';
import {
  checkPasswordStrength,
  cn,
  MIN_ACCEPTABLE_PASSWORD_STRENGTH,
} from '@/lib/utils';
import {
  type OnboardingFormValues,
  onboardingFormSchema,
} from '@/schemas/onboarding';
import { useOnboardingUIStore } from '@/store/onboarding-ui-store';
import type { BrandColors } from '@/types';
// Dynamically import heavy interactive components for preview
import { OnboardingPuckPreview } from './onboarding-puck-preview';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

const OnboardingTemplateEditor = dynamic(
  () =>
    import('./onboarding-template-editor').then(
      (mod) => mod.OnboardingTemplateEditor
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full min-h-[400px]" />,
  }
);

// --- Helper Components ---

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  // Calculate progress with a minimum of 15% for step 1 to show visual feedback
  const baseProgress = ((currentStep - 1) / (totalSteps - 1)) * 100;
  const progress = currentStep === 1 ? 15 : baseProgress;
  return (
    <div className="flex items-center gap-4">
      <Progress
        value={progress}
        className="w-full"
        aria-label="Onboarding progress"
      />
      <span
        className="text-sm text-muted-foreground whitespace-nowrap"
        aria-live="polite"
      >
        Step {currentStep} of {totalSteps}
      </span>
    </div>
  );
}

function OnboardingNavigation({
  currentStep,
  totalSteps,
  onNext,
  onPrev,
  isLoading,
  isStepValid,
  user,
  isSubmitting,
}: {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  isLoading: boolean;
  isStepValid: boolean;
  user?: User | null;
  isSubmitting?: boolean;
}) {
  const isLastStep = currentStep === totalSteps;

  return (
    <div className="flex justify-between pt-4">
      {currentStep > 1 ? (
        <Button
          type="button"
          variant="outline"
          onClick={onPrev}
          disabled={isLoading}
        >
          Previous
        </Button>
      ) : (
        <div />
      )}
      {isLastStep ? (
        <Button
          type="submit"
          disabled={isLoading || !isStepValid}
          id="submit-button"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 size-4 motion-safe:animate-spin" />
              {isSubmitting
                ? user
                  ? 'Saving...'
                  : 'Creating Store...'
                : 'Loading...'}
            </>
          ) : user ? (
            'Finish Setup'
          ) : (
            'Create My Store'
          )}
        </Button>
      ) : (
        <Button type="button" onClick={onNext} disabled={isLoading}>
          Next
        </Button>
      )}
    </div>
  );
}

// --- Main Form Component ---
export default function OnboardingForm() {
  const [step, setStep] = useState(1);
  const [submissionState, formAction, isPending] = useActionState<
    ServerActionState,
    FormData
  >(submitOnboarding, { message: '', success: false });
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isSubmitting, startTransition] = useTransition();
  const [user, setUser] = useState<User | null>(null);

  // Preview State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [templateData, setTemplateData] = useState<Data | null>(null);

  // Subscribe to global store for immediate logo preview
  const storeLogoDataUri = useOnboardingUIStore((state) => state.logoDataUri);
  const { toast } = useToast();
  const _router = useRouter();
  const totalSteps = 3;
  const searchParams = useSearchParams();

  const form = useForm<OnboardingFormValues>({
    // biome-ignore lint/suspicious/noExplicitAny: library type mismatch
    resolver: zodResolver(onboardingFormSchema as any),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    shouldUnregister: false,
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      businessName: '',
      businessType: '',
      country: '',
      otherBusinessType: '',
      brandPreferences: '',
      logoUrl: '',
      brandColors: '',
    },
  });

  const {
    formState: { errors },
  } = form;

  useEffect(() => {
    // Check for existing session
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        form.setValue('email', session.user.email || '');
      }
    });

    const fromMagicLink = searchParams.get('fromMagicLink');
    if (fromMagicLink) {
      const savedData = localStorage.getItem('onboardingForm');
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        form.reset(parsedData.values);
        form.setValue('logoUrl', parsedData.logoDataUri);
        form.setValue('brandColors', parsedData.brandColors);
        // Defer state update to avoid cascading renders
        queueMicrotask(() => {
          setStep(3);
          toast({
            title: 'Welcome back!',
            description:
              "You are now logged in. Please click 'Create My Store' to finish.",
            duration: 5000,
          });
        });
      }
    }
  }, [searchParams, form, toast]);

  // Handle successful submission. `isRedirecting` is derived from the action
  // result during render rather than mirrored into state via the effect, which
  // avoids the synchronous setState-in-effect cascade and lets the React
  // Compiler memoize this component. Once the action succeeds the page redirects
  // away, so the value never needs to flip back to `false`.
  const isRedirecting = submissionState.success;

  useEffect(() => {
    if (submissionState.success) {
      localStorage.removeItem('onboardingForm');
      toast({
        title: 'Store Created!',
        description:
          'Your e-commerce store is ready. Redirecting you to the dashboard...',
      });

      // Track merchant signup completed for platform analytics
      if (submissionState.merchantId) {
        trackMerchantSignupCompleted(submissionState.merchantId, {
          business_name: submissionState.businessName,
        });
      }

      // Server action succeeded - redirect directly to dashboard
      // The server already verified the session and created the merchant
      // No need to re-check client-side which can have cookie timing issues
      const redirectTimeoutId = window.setTimeout(() => {
        window.location.href = '/dashboard';
      }, 3000); // 3s delay for animation cycle and DB propagation

      return () => {
        window.clearTimeout(redirectTimeoutId);
      };
    } else if (submissionState.message) {
      const fieldErrors = submissionState.errors?.fieldErrors;
      if (fieldErrors) {
        Object.entries(fieldErrors).forEach(([fieldName, messages]) => {
          if (messages?.length) {
            form.setError(fieldName as keyof OnboardingFormValues, {
              type: 'server',
              message: messages.join(', '),
            });
          }
        });
      }
      if (!fieldErrors || Object.keys(fieldErrors).length === 0) {
        toast({
          title: 'An error occurred',
          description: submissionState.message,
          variant: 'destructive',
        });
      }
    }
  }, [submissionState, form, toast]);

  const handleNext = async () => {
    let isValidStep = false;
    if (step === 1) {
      isValidStep = await form.trigger([
        'businessName',
        'businessType',
        'country',
        'otherBusinessType',
      ]);
    } else if (step === 2) {
      isValidStep = await form.trigger(['logoUrl', 'brandColors']);
      if (!isValidStep) {
        toast({
          title: 'Branding Incomplete',
          description: 'Please upload a logo to extract brand colors.',
          variant: 'destructive',
        });
      }
    }

    if (isValidStep) {
      if (step === 2) {
        const values = form.getValues();
        trackMerchantSignupStarted({
          business_name: values.businessName,
          business_type: values.businessType,
        });
      }
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const handleKeyDown = async (
    e: React.KeyboardEvent<HTMLInputElement | HTMLButtonElement>
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isImeComposing(e)) return;
      if (step < totalSteps) {
        await handleNext();
      } else {
        document.getElementById('submit-button')?.click();
      }
    }
  };

  const handleMagicLinkSent = () => {
    const values = form.getValues();
    const dataToSave = {
      values: {
        businessName: values.businessName,
        businessType: values.businessType,
        country: values.country,
        otherBusinessType: values.otherBusinessType,
        brandPreferences: values.brandPreferences,
        email: values.email,
      },
      logoDataUri: values.logoUrl,
      brandColors: values.brandColors,
    };
    localStorage.setItem('onboardingForm', JSON.stringify(dataToSave));
    setMagicLinkSent(true);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const values = form.getValues();
    const logoUrl = values.logoUrl;

    const formData = new FormData();
    formData.append('email', values.email || '');
    formData.append('password', values.password || '');
    formData.append('confirmPassword', values.confirmPassword || '');
    formData.append('businessName', values.businessName || '');
    formData.append('businessType', values.businessType || '');
    formData.append('country', values.country || '');
    formData.append('otherBusinessType', values.otherBusinessType || '');
    formData.append('brandPreferences', values.brandPreferences || '');
    formData.append('logoUrl', logoUrl || '');
    formData.append('brandColors', values.brandColors || '');

    startTransition(() => {
      formAction(formData);
    });
  };

  const formEmail = useWatch({ control: form.control, name: 'email' });
  const formPassword = useWatch({ control: form.control, name: 'password' });
  const formConfirmPassword = useWatch({
    control: form.control,
    name: 'confirmPassword',
  });

  // Watch fields for Preview
  const brandColors = useWatch({ control: form.control, name: 'brandColors' });
  const businessName = useWatch({
    control: form.control,
    name: 'businessName',
  });
  const businessType = useWatch({
    control: form.control,
    name: 'businessType',
  });
  const logoUrl = useWatch({ control: form.control, name: 'logoUrl' });

  // Parse brandColors to prevent infinite re-renders in preview
  let parsedBrandColors: BrandColors | undefined;
  if (brandColors) {
    try {
      parsedBrandColors = JSON.parse(brandColors) as BrandColors;
    } catch {
      // Invalid JSON, keep undefined
    }
  }

  const showPreview = step === 2 && !!brandColors;

  // 2025 Best Practice: Use form errors from zodResolver as single source of truth
  // No duplicate schema validation needed
  let isCurrentStepValid = false;
  if (step === 1) {
    isCurrentStepValid =
      !errors.businessName && !errors.businessType && !errors.otherBusinessType;
  } else if (step === 2) {
    isCurrentStepValid = !errors.logoUrl && !errors.brandColors;
  } else if (step === 3) {
    // For step 3, check: email valid
    const hasValidEmail = !!formEmail && !errors.email;

    // If user is already authenticated (e.g. via Magic Link), password is not required
    if (user) {
      isCurrentStepValid = hasValidEmail;
    } else {
      // Keep the final-step gating aligned with the onboarding schema.
      const hasAcceptablePasswordStrength =
        !!formPassword &&
        checkPasswordStrength(formPassword) >= MIN_ACCEPTABLE_PASSWORD_STRENGTH;
      const passwordsMatch = formPassword === formConfirmPassword;
      const noPasswordErrors = !errors.password && !errors.confirmPassword;

      isCurrentStepValid =
        hasValidEmail &&
        hasAcceptablePasswordStrength &&
        passwordsMatch &&
        noPasswordErrors;
    }
  }

  if (isRedirecting) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-y-4 bg-muted/10">
        <div className="relative size-20">
          <div className="relative flex h-full w-full items-center justify-center">
            <BagLoader size={80} />
          </div>
        </div>
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            Preparing Dashboard
          </h2>
          <p className="text-muted-foreground">
            Setting up your new store environment…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'transition-all duration-500 ease-in-out w-full min-h-screen flex items-center justify-center p-4',
        showPreview ? 'max-w-[1600px] mx-auto' : 'max-w-2xl mx-auto'
      )}
    >
      <div
        className={cn(
          'w-full transition-all duration-500',
          showPreview
            ? 'grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center'
            : 'flex justify-center'
        )}
      >
        {/* Main Form Card - Left Square */}
        <div
          className={cn(
            'relative overflow-hidden rounded-3xl border border-white/10 bg-white/60 dark:bg-black/40 backdrop-blur-xl shadow-2xl transition-all duration-500 w-full z-20',
            showPreview
              ? 'lg:aspect-square max-w-[650px] mx-auto flex flex-col' // Square on desktop only
              : 'max-w-2xl'
          )}
        >
          {/* Glass Shine Effect */}
          <div className="absolute inset-0 bg-linear-to-br from-white/20 via-transparent to-transparent pointer-events-none" />

          <div
            className={cn(
              'relative transition-all duration-500 flex flex-col h-full',
              showPreview ? 'p-5 md:p-6 lg:p-8 lg:justify-center' : 'p-6 md:p-8'
            )}
          >
            <div className="flex flex-col items-center text-center mb-4 md:mb-6 mt-2 md:mt-4">
              <Link
                href="/"
                className="mb-3 md:mb-4 transition-transform hover:scale-105"
              >
                <Logo />
              </Link>
            </div>

            <div
              className={cn(
                'gap-y-4 w-full mx-auto',
                showPreview ? 'max-w-full' : 'max-w-lg'
              )}
            >
              <header>
                <h2 className="text-xl md:text-2xl font-bold text-center font-headline">
                  Welcome to Baci
                </h2>
                <p className="text-muted-foreground text-center">
                  Let's set up your store in a few simple steps.
                </p>
              </header>
              <StepIndicator currentStep={step} totalSteps={totalSteps} />
              <FormProvider {...form}>
                <form
                  onSubmit={handleFormSubmit}
                  aria-label="Store onboarding form"
                  noValidate
                >
                  <input type="hidden" {...form.register('logoUrl')} />
                  <input type="hidden" {...form.register('brandColors')} />
                  <section
                    aria-live="polite"
                    aria-atomic="true"
                    className="min-h-[200px] md:min-h-[250px]"
                  >
                    {step === 1 && (
                      <Step1_BusinessDetails onKeyDown={handleKeyDown} />
                    )}
                    {step === 2 && <Step2_Branding />}
                    {step === 3 &&
                      (magicLinkSent ? (
                        <Alert className="mt-4">
                          <AlertCircle className="size-4" />
                          <AlertTitle>Magic Link Sent!</AlertTitle>
                          <AlertDescription>
                            Please check your email for a link to sign in. You
                            can close this window.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Step3_Account
                          onKeyDown={handleKeyDown}
                          onMagicLinkSent={handleMagicLinkSent}
                          user={user}
                        />
                      ))}
                  </section>
                  <OnboardingNavigation
                    currentStep={step}
                    totalSteps={totalSteps}
                    onNext={handleNext}
                    onPrev={handlePrev}
                    isLoading={isPending || isSubmitting}
                    isStepValid={isCurrentStepValid}
                    // Pass user and isSubmitting to OnboardingNavigation for button text logic
                    user={user}
                    isSubmitting={isSubmitting}
                  />

                  {/* Already have account - Inside the form card */}
                  <p className="text-center text-sm text-muted-foreground pt-2">
                    Already have an account?{' '}
                    <Link
                      href="/login"
                      className="text-primary font-medium hover:underline underline-offset-4 transition-colors"
                    >
                      Log in
                    </Link>
                  </p>
                </form>
              </FormProvider>
            </div>
          </div>
        </div>

        {/* Live Preview Panel - Right Square (Desktop Only) */}
        {showPreview && (
          <div className="hidden lg:block w-full max-w-[650px] mx-auto aspect-square animate-in slide-in-from-left duration-500 h-full z-10">
            {isEditorOpen && templateData ? (
              <OnboardingTemplateEditor
                initialData={templateData}
                businessName={businessName}
                brandColors={parsedBrandColors || null}
                onClose={() => setIsEditorOpen(false)}
                onSave={(data) => {
                  setTemplateData(data);
                  setIsEditorOpen(false);
                }}
              />
            ) : (
              <OnboardingPuckPreview
                businessName={businessName}
                businessType={businessType}
                logoDataUri={storeLogoDataUri || logoUrl}
                brandColors={parsedBrandColors}
                data={templateData}
                onEdit={(data) => {
                  setTemplateData(data);
                  setIsEditorOpen(true);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
