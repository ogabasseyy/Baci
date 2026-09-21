'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  Mail,
  Sparkles,
  Truck,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from 'react-hook-form';
import {
  type Country as CountryCode,
  isValidPhoneNumber,
} from 'react-phone-number-input';
import z from 'zod';
import { AddressAutocomplete } from '@/components/address-autocomplete';
import { trackPlatformPurchase } from '@/components/analytics/platform-analytics-provider';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { OrderSummary } from '@/components/order-summary';
import { CheckoutProgress } from '@/components/storefront/checkout/checkout-progress';
import { DiscountCodeInput } from '@/components/storefront/checkout/discount-code-input';
import {
  SelectedShippingDisplay,
  ShippingOptions,
} from '@/components/storefront/checkout/shipping-options';
import { ThemedButton, ThemedInput } from '@/components/themed';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PhoneInput } from '@/components/ui/phone-input';
import { useCart } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import { MerchantProvider, useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiPost } from '@/lib/api-client';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { calculateCartCatalogSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';
import { getCountryByCode } from '@/lib/countries';
import { trackEvent } from '@/lib/event-tracking';
import { trackServerSideBeginCheckout } from '@/lib/server-side-analytics';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { createClient } from '@/lib/supabase/client';
import type { ShippingQuote } from '@/types/shipping-quote';
import { buildCheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';
import { handoffLegacyCreditDirectSuccess } from './credit-direct-success';
import { captureLegacyCreditDirectPopup } from './legacy-credit-direct-popup';
import { openLegacyCreditDirectPopup } from './open-legacy-credit-direct-popup';
import { prepareLegacyCreditDirectCheckout } from './prepare-legacy-credit-direct-checkout';
import { notifyLastOrderSnapshotChanged } from './success/client-page-order-snapshot';

const DEFAULT_SHIPPING_FEE = Number.parseFloat(
  process.env.NEXT_PUBLIC_DEFAULT_SHIPPING_FEE ?? '10.00'
);
const PAYMENT_REFERENCE_UPDATE_ATTEMPTS = 3;
const PAYMENT_REFERENCE_UPDATE_RETRY_DELAY_MS = 400;

const shippingSchema = z.object({
  firstName: z
    .string()
    .min(2, { message: 'First name must be at least 2 characters.' }),
  lastName: z
    .string()
    .min(2, { message: 'Last name must be at least 2 characters.' }),
  email: z.email({ error: 'Please enter a valid email address.' }),
  phone: z.string().refine(isValidPhoneNumber, {
    message: 'Please enter a valid phone number.',
  }),
  address: z.string().min(5, { message: 'Please enter a valid address.' }),
  city: z.string().min(2, { message: 'Please enter a city.' }),
  state: z.string().min(2, { message: 'Please enter a state.' }),
});

type ShippingFormValues = z.infer<typeof shippingSchema>;

// OTP Auth schema for customer authentication
const otpAuthSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
});

type OtpAuthFormValues = z.infer<typeof otpAuthSchema>;

// Customer data interface for pre-filling form
interface CustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  saved_addresses?: Array<{
    first_name: string;
    last_name: string;
    full_name?: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    is_default?: boolean;
  }>;
}

// Module-scope network helpers keep the try/catch/finally + throw control
// flow out of the component body so React Compiler can memoize Step0_Auth.
type SendOtpResult = { ok: true } | { ok: false; message: string };

async function sendOtpCode(
  email: string,
  merchantSlug: string
): Promise<SendOtpResult> {
  try {
    await apiPost('/api/storefront/auth/send-code', { email, merchantSlug });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'Failed to send verification code',
    };
  }
}

type VerifyOtpResult =
  | { ok: true; user: SupabaseUser; customer?: CustomerData }
  | { ok: false; message: string };

interface VerifyOtpResponse {
  customer?: CustomerData;
}

async function verifyOtpCode(
  email: string,
  code: string,
  merchantSlug: string
): Promise<VerifyOtpResult> {
  try {
    const result = await apiPost<VerifyOtpResponse>(
      '/api/storefront/auth/verify-code',
      { email, token: code, merchantSlug }
    );

    // Get user from Supabase client (session should be set)
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      return { ok: false, message: 'Authentication failed. Please try again.' };
    }

    return { ok: true, user: userData.user, customer: result.customer };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to verify code',
    };
  }
}

// Hard navigation to an external payment URL. Assigning `window.location.href`
// is a mutation of a value outside the component, which trips React Compiler's
// immutability check — isolating it in a module-scope helper keeps the
// component body memoizable.
function redirectToExternalUrl(url: string) {
  window.location.href = url;
}

interface CreateCheckoutOrderInput {
  merchantId: string;
  data: ShippingFormValues;
  orderItems: ReturnType<typeof buildCheckoutOrderItems>;
  subtotal: number;
  finalShippingFee: number;
  selectedGateway: 'paystack' | 'korapay' | 'pod' | 'credit_direct';
  selectedShippingQuote: ShippingQuote;
  shippingSessionId: string;
  discountCode?: string | null;
}

interface CheckoutOrderResponse {
  order: Record<string, unknown>;
  paystackAuthUrl?: string;
}

// Create the order server-side. Kept at module scope so the order-submit
// handler stays free of the try/throw control flow the compiler can't lower.
function createCheckoutOrder(
  input: CreateCheckoutOrderInput
): Promise<CheckoutOrderResponse> {
  return apiPost<CheckoutOrderResponse>('/api/orders', {
    merchant_id: input.merchantId,
    customer_email: input.data.email,
    customer_name: `${input.data.firstName} ${input.data.lastName}`,
    customer_phone: input.data.phone,
    items: input.orderItems,
    subtotal: input.subtotal,
    shipping_fee: input.finalShippingFee,
    payment_method: input.selectedGateway,
    payment_status: 'unpaid', // Order starts unpaid, changes to pending when payment initiated, then paid on confirmation
    shipping_status: 'pending',
    shipping_address: {
      firstName: input.data.firstName,
      lastName: input.data.lastName,
      address: input.data.address,
      city: input.data.city,
      state: input.data.state,
    },
    source: 'online_store',
    // The submit guard guarantees a selected quote. Carrier quotes reference
    // their persisted quote row; merchant rates send their bare configured
    // rate id and intentionally null the carrier fields.
    ...buildCheckoutShippingSelectionPayload(
      input.selectedShippingQuote,
      input.shippingSessionId
    ),
    // Only the trusted code string is sent; the route recomputes + validates
    // the amount server-side. No expected_total here (this legacy flow has no
    // VAT-aware total object), so the wrapper's two-sided amount check guards.
    ...(input.discountCode ? { discount_code: input.discountCode } : {}),
  });
}

interface CreditDirectSignResult {
  signature: string;
  publicKey: string;
  sessionId: string;
  isLive: boolean;
  // Server-derived amount that was actually signed. For orders with a wallet,
  // savings or prior partial payment this is the RESIDUAL, not order.total, and
  // the HMAC folds it in — so the popup must use this value or the provider
  // cannot complete checkout. Required: we fail closed rather than fall back to
  // a client-side total.
  amount: number;
}

type SignCreditDirectResult =
  | { ok: true; data: CreditDirectSignResult }
  | { ok: false; message: string };

// Request a signed Credit Direct session. The not-ok branch returns a result
// instead of throwing so the order-submit handler avoids throw-in-try/catch.
async function signCreditDirectCheckout(input: {
  customerEmail: string;
  totalAmount: unknown;
  merchantSlug: string | null;
  orderId: unknown;
  trackingToken: unknown;
}): Promise<SignCreditDirectResult> {
  try {
    const data = await apiPost<CreditDirectSignResult>(
      '/api/payments/credit-direct/sign',
      {
        customerEmail: input.customerEmail,
        totalAmount: input.totalAmount,
        merchantSlug: input.merchantSlug,
        orderId: input.orderId,
        // Required by the sign schema (guest capability binding); omitting it
        // 400s before a checkout token is ever issued.
        trackingToken: input.trackingToken,
      }
    );

    // Fail closed: the popup must use the SERVER-signed amount, never a
    // client-side total, or it diverges from the HMAC input.
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      return {
        ok: false,
        message: 'Credit Direct signing response has an invalid amount',
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Failed to initialize Credit Direct checkout',
    };
  }
}

interface UpdateCreditDirectPaymentReferenceInput {
  orderId: string;
  paymentRef: string;
}

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function updateCreditDirectPaymentReferenceWithRetry(
  input: UpdateCreditDirectPaymentReferenceInput
): Promise<string | null> {
  let lastError = 'Failed to save payment reference';

  for (
    let attempt = 1;
    attempt <= PAYMENT_REFERENCE_UPDATE_ATTEMPTS;
    attempt++
  ) {
    try {
      await apiPost('/api/orders/update-payment-ref', {
        orderId: input.orderId,
        paymentRef: input.paymentRef,
        gateway: 'credit_direct',
      });
      return null;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : 'Failed to save payment reference';

      if (attempt < PAYMENT_REFERENCE_UPDATE_ATTEMPTS) {
        await waitForRetry(
          PAYMENT_REFERENCE_UPDATE_RETRY_DELAY_MS * 2 ** (attempt - 1)
        );
      }
    }
  }

  return lastError;
}

// Outcome of preparing a checkout — the component executes the matching side
// effect (navigation, popup, toast). All try/catch lives here at module scope
// so the submit handler stays free of compiler-unsupported control flow.
type CheckoutPreparation =
  | { kind: 'error'; title: string; message: string }
  | {
      kind: 'credit_direct';
      order: Record<string, unknown>;
      sign: CreditDirectSignResult;
      orderItems: ReturnType<typeof buildCheckoutOrderItems>;
    }
  | {
      kind: 'redirect';
      order: Record<string, unknown>;
      paystackAuthUrl?: string;
    };

interface PrepareCheckoutInput {
  merchantId: string;
  data: ShippingFormValues;
  cart: CheckoutCartItem[];
  cartTotal: number;
  shippingFee: number | null;
  selectedGateway: 'paystack' | 'korapay' | 'pod' | 'credit_direct';
  selectedShippingQuote: ShippingQuote;
  shippingSessionId: string;
  currencyCode: string;
  merchantSlug: string | null;
  discountCode?: string | null;
}

type CheckoutCartItem = Parameters<typeof buildCheckoutOrderItems>[0][number];

// Create the order, persist the success-page snapshot, fire analytics, and
// (for BNPL) fetch the Credit Direct signature. Returns a description of the
// next step for the component to perform.
async function prepareCheckout(
  input: PrepareCheckoutInput
): Promise<CheckoutPreparation> {
  try {
    const orderItems = buildCheckoutOrderItems(input.cart);
    const subtotal = input.cartTotal;
    const finalShippingFee = input.shippingFee ?? DEFAULT_SHIPPING_FEE;

    const { order, paystackAuthUrl } = await createCheckoutOrder({
      merchantId: input.merchantId,
      data: input.data,
      orderItems,
      subtotal,
      finalShippingFee,
      selectedGateway: input.selectedGateway,
      selectedShippingQuote: input.selectedShippingQuote,
      shippingSessionId: input.shippingSessionId,
      discountCode: input.discountCode,
    });

    // Store order data for success page (fallback)
    const orderData = {
      order_id: order.id,
      order_number: order.order_number,
      shipping: input.data,
      items: input.cart,
      subtotal,
      shipping_fee: finalShippingFee,
      total: order.total,
    };
    sessionStorage.setItem('lastOrder', JSON.stringify(orderData));
    notifyLastOrderSnapshotChanged();

    // Preserve the legacy fanout while the server-side durable producer owns
    // delivery after cutover. In durable mode this client claim is stored as
    // observation-only telemetry and cannot create provider deliveries.
    trackPlatformPurchase(
      input.merchantId,
      order.total as number,
      input.currencyCode,
      order.order_number as string
    );

    if (input.selectedGateway === 'credit_direct') {
      const amounts = prepareLegacyCreditDirectCheckout(
        orderItems,
        Number(order.total)
      );
      const signResult = await signCreditDirectCheckout({
        customerEmail: input.data.email,
        totalAmount: amounts.totalAmount,
        merchantSlug: input.merchantSlug,
        orderId: order.id,
        trackingToken: order.tracking_token ?? '',
      });

      if (!signResult.ok) {
        return {
          kind: 'error',
          title: 'BNPL Checkout Failed',
          message:
            signResult.message || 'Failed to start Credit Direct checkout',
        };
      }

      return {
        kind: 'credit_direct',
        order,
        sign: signResult.data,
        orderItems,
      };
    }

    return { kind: 'redirect', order, paystackAuthUrl };
  } catch (error) {
    return {
      kind: 'error',
      title: 'Order Failed',
      message: (error as Error).message || 'Something went wrong.',
    };
  }
}

function Step0_Auth({
  onAuthSuccess,
  onGuestCheckout,
  merchantSlug,
}: {
  onAuthSuccess: (user: SupabaseUser, customerData?: CustomerData) => void;
  onGuestCheckout: () => void;
  merchantSlug: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const { toast } = useToast();
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const form = useForm<OtpAuthFormValues>({
    resolver: zodResolver(otpAuthSchema),
    defaultValues: { email: '' },
  });

  // Send OTP code
  const handleSendOtp = async (data: OtpAuthFormValues) => {
    setIsLoading(true);
    setError('');

    const result = await sendOtpCode(data.email, merchantSlug);
    setIsLoading(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setEmail(data.email);
    setOtpSent(true);
    toast({
      title: 'Code sent!',
      description: 'Check your email for the 6-digit verification code.',
    });
  };

  // Handle OTP input change
  const handleOtpChange = (index: number, value: string) => {
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...otpCode];
    newCode[index] = value;
    setOtpCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (newCode.every((d) => d) && newCode.join('').length === 6) {
      handleVerifyOtp(newCode.join(''));
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace' && !otpCode[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newCode = [...otpCode];
    for (let i = 0; i < pastedData.length && i < 6; i++) {
      newCode[i] = pastedData[i];
    }
    setOtpCode(newCode);

    if (newCode.every((d) => d) && newCode.join('').length === 6) {
      handleVerifyOtp(newCode.join(''));
    }
  };

  // Verify OTP code
  const handleVerifyOtp = async (code: string) => {
    setIsLoading(true);
    setError('');

    const result = await verifyOtpCode(email, code, merchantSlug);
    setIsLoading(false);

    if (!result.ok) {
      setError(result.message);
      setOtpCode(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
      return;
    }

    onAuthSuccess(result.user, result.customer);
  };

  return (
    <div className="space-y-4">
      {!otpSent ? (
        // Email input form
        <>
          <div className="text-center mb-6">
            <h3 className="text-lg font-medium">Sign in to checkout</h3>
            <p className="text-sm text-muted-foreground mt-1">
              We'll send you a verification code - no password needed
            </p>
          </div>

          <FormProvider {...form}>
            <form
              onSubmit={form.handleSubmit(handleSendOtp)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <ThemedInput
                          type="email"
                          placeholder="you@example.com"
                          {...field}
                          className="pl-10"
                          id="email"
                          name="email"
                          autoComplete="email"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <ThemedButton
                type="submit"
                colorRole="primary"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading && (
                  <Loader2 className="mr-2 size-4 motion-safe:animate-spin" />
                )}
                Continue with email
              </ThemedButton>
            </form>
          </FormProvider>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={onGuestCheckout}
          >
            Continue as guest
          </Button>
        </>
      ) : (
        // OTP verification form
        <>
          <div className="text-center mb-6">
            <h3 className="text-lg font-medium">Enter verification code</h3>
            <p className="text-sm text-muted-foreground mt-1">
              We sent a 6-digit code to {email}
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
              {otpCode.map((digit, index) => (
                <input
                  // biome-ignore lint/suspicious/noArrayIndexKey: OTP inputs are fixed-size array (6 digits) that never reorders
                  key={index}
                  ref={(el) => {
                    otpInputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  className="w-12 h-14 text-center text-2xl font-mono border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-background"
                  aria-label={`Verification code digit ${index + 1}`}
                  disabled={isLoading}
                />
              ))}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            {isLoading && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Verifying…</span>
              </div>
            )}

            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Didn't receive the code?
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSendOtp({ email })}
                disabled={isLoading}
              >
                {isLoading ? 'Sending...' : 'Resend code'}
              </Button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setOtpSent(false);
                setOtpCode(['', '', '', '', '', '']);
                setError('');
              }}
            >
              Use a different email
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Step1_Shipping({
  onShippingSelect,
  selectedQuote,
}: {
  onShippingSelect: (quote: ShippingQuote, sessionId: string) => void;
  selectedQuote: ShippingQuote | null;
}) {
  const { control, setValue } = useFormContext<ShippingFormValues>();
  const { merchant } = useMerchant();
  const { cart } = useCart();

  const cartSubtotal = calculateCartCatalogSubtotal(
    cart,
    hasStorefrontPriceNegotiation(merchant)
  );

  const country = merchant?.country ? getCountryByCode(merchant.country) : null;
  const isNigerian = country?.code === 'NG' || !country;

  // Use useWatch instead of watch - watch doesn't trigger re-renders in nested components!
  const watchCity = useWatch({ control, name: 'city' });
  const watchState = useWatch({ control, name: 'state' });
  const watchAddress = useWatch({ control, name: 'address' });
  const watchPhone = useWatch({ control, name: 'phone' });
  const watchFirstName = useWatch({ control, name: 'firstName' });
  const watchLastName = useWatch({ control, name: 'lastName' });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <ThemedInput
                    placeholder="John"
                    {...field}
                    className="pl-10"
                    id="firstName"
                    name="firstName"
                    autoComplete="given-name"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="lastName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name (Surname)</FormLabel>
              <FormControl>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <ThemedInput
                    placeholder="Doe"
                    {...field}
                    className="pl-10"
                    id="lastName"
                    name="lastName"
                    autoComplete="family-name"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <ThemedInput
                  type="email"
                  placeholder="you@example.com"
                  {...field}
                  className="pl-10"
                  id="shipping-email"
                  name="shipping-email"
                  autoComplete="email"
                />
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone Number</FormLabel>
            <FormControl>
              <PhoneInput
                placeholder="Enter phone number"
                defaultCountry={(country?.code as CountryCode) || 'NG'}
                value={field.value}
                onChange={field.onChange}
                id="phone"
                autoComplete="tel"
                limitMaxLength={true}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Address Input - Use Nigerian autocomplete for Nigerian merchants */}
      <FormField
        control={control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Delivery Address</FormLabel>
            <FormControl>
              <AddressAutocomplete
                {...field}
                useThemedInput={true}
                showIcon={true}
                placeholder="Enter your full address"
                country={country?.code}
                onChange={(val) => field.onChange(val)}
                onSelect={(place) => {
                  field.onChange(place.formattedAddress);
                  // If Google Maps returns Lagos as both city and state, clear city to force user input
                  if (place.city === 'Lagos' && place.state === 'Lagos') {
                    setValue('city', '', {
                      shouldValidate: false,
                      shouldDirty: true,
                    });
                  } else {
                    setValue('city', place.city, {
                      shouldValidate: false,
                      shouldDirty: true,
                    });
                  }
                  setValue('state', place.state, {
                    shouldValidate: false,
                    shouldDirty: true,
                  });
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* City and State - Auto-filled from address but editable */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <ThemedInput
                  placeholder="e.g. Ikeja, Lekki, Yaba"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <ThemedInput
                  placeholder="e.g. Lagos"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Shipping Options - Show when address is complete */}
      {watchCity && watchState && isNigerian && (
        <div className="pt-4 border-t">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Truck className="size-5" />
            Shipping Options
          </h3>
          <ShippingOptions
            merchantId={merchant?.id || ''}
            receiverCity={watchCity}
            receiverState={watchState}
            receiverAddress={watchAddress}
            receiverPhone={watchPhone}
            receiverName={`${watchFirstName} ${watchLastName}`}
            cartItems={cart.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            }))}
            cartSubtotal={cartSubtotal}
            onSelect={onShippingSelect}
            selectedQuoteId={selectedQuote?.id}
          />
        </div>
      )}
    </div>
  );
}

interface PaymentGatewaySettings {
  paystackEnabled: boolean;
  korapayEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  creditDirectEnabled: boolean;
  creditDirectMinAmount: number;
  creditDirectMaxAmount: number;
  preferredLocalGateway: 'paystack' | 'korapay';
  preferredInternationalGateway: 'paystack' | 'korapay';
}

function Step2_Payment({
  selectedQuote,
  paymentSettings,
  selectedGateway,
  onGatewaySelect,
  orderTotal,
}: {
  selectedQuote: ShippingQuote | null;
  paymentSettings: PaymentGatewaySettings;
  selectedGateway: 'paystack' | 'korapay' | 'pod' | 'credit_direct';
  onGatewaySelect: (
    gateway: 'paystack' | 'korapay' | 'pod' | 'credit_direct'
  ) => void;
  orderTotal: number;
}) {
  const availableGateways: Array<{
    id: 'paystack' | 'korapay' | 'pod' | 'credit_direct';
    name: string;
    description: string;
    features: string[];
    color: string;
  }> = [];

  if (paymentSettings.paystackEnabled) {
    availableGateways.push({
      id: 'paystack',
      name: 'Paystack',
      description: 'Cards, Bank Transfer, USSD',
      features: ['Visa/Mastercard', 'Bank Transfer', 'USSD'],
      color: '#00C3F7',
    });
  }

  if (paymentSettings.korapayEnabled) {
    availableGateways.push({
      id: 'korapay',
      name: 'Korapay',
      description: 'Multi-currency payments',
      features: ['Cards', 'Bank Transfer', 'Mobile Money'],
      color: '#6366F1',
    });
  }

  if (paymentSettings.payOnDeliveryEnabled) {
    availableGateways.push({
      id: 'pod',
      name: 'Pay on Delivery',
      description: 'Pay when you receive your order',
      features: ['Cash', 'Transfer on Delivery'],
      color: '#10B981',
    });
  }

  // Credit Direct BNPL - only show if enabled and order amount is within limits
  const isCreditDirectEligible =
    paymentSettings.creditDirectEnabled &&
    orderTotal >= paymentSettings.creditDirectMinAmount &&
    orderTotal <= paymentSettings.creditDirectMaxAmount;

  if (isCreditDirectEligible) {
    availableGateways.push({
      id: 'credit_direct',
      name: 'Pay Later with Credit Direct',
      description: 'Split payment into easy installments',
      features: ['No Interest', 'Instant Approval', 'Flexible Payments'],
      color: '#7C3AED',
    });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Shipping & Payment</h3>
      <SelectedShippingDisplay quote={selectedQuote} />

      {availableGateways.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select payment method:
          </p>
          {availableGateways.map((gateway) => (
            <button
              key={gateway.id}
              type="button"
              onClick={() => onGatewaySelect(gateway.id)}
              className={`w-full rounded-lg border p-4 text-left transition-all ${
                selectedGateway === gateway.id
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className="flex size-10 items-center justify-center rounded-lg text-white font-bold text-sm"
                  style={{ backgroundColor: gateway.color }}
                >
                  {gateway.id === 'paystack'
                    ? 'PS'
                    : gateway.id === 'korapay'
                      ? 'KP'
                      : gateway.id === 'credit_direct'
                        ? 'CD'
                        : 'POD'}
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{gateway.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {gateway.description}
                  </p>
                </div>
                {selectedGateway === gateway.id && (
                  <div className="size-5 rounded-full bg-primary flex items-center justify-center">
                    <svg
                      className="size-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {gateway.features.map((feature) => (
                  <span
                    key={feature}
                    className="text-xs bg-muted px-2 py-0.5 rounded-full"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          <div className="flex items-center gap-4">
            <CreditCard className="size-8 text-muted-foreground" />
            <div>
              <p className="font-semibold">No payment methods available</p>
              <p className="text-sm text-muted-foreground">
                Please contact the store owner.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Discount type for checkout
interface DiscountResult {
  valid: boolean;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  // Server-computed amount from the validate endpoint — the display source of
  // truth so caps/rounding match the order route and the redemption RPC.
  discount_amount?: number;
  minimum_order?: number;
  description?: string;
}

const DEFAULT_PAYMENT_SETTINGS: PaymentGatewaySettings = {
  paystackEnabled: true,
  korapayEnabled: true,
  payOnDeliveryEnabled: false,
  creditDirectEnabled: false,
  creditDirectMinAmount: 10000,
  creditDirectMaxAmount: 500000,
  preferredLocalGateway: 'paystack',
  preferredInternationalGateway: 'korapay',
};

function CheckoutPageContent() {
  const router = useRouter();
  const { toast } = useToast();
  const { clearCart, cart, cartCount, cartTotal, merchantSlug } = useCart();
  const { merchant, basePath } = useMerchant();
  const { currencyCode, formatCurrency } = useCurrency();
  const [step, setStep] = useState(0); // 0: Auth, 1: Shipping, 2: Payment
  const [pageLoading, setPageLoading] = useState(true);
  const [formIsLoading, setFormIsLoading] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [_isGuestCheckout, setIsGuestCheckout] = useState(false);
  const [shippingFee, setShippingFee] = useState<number | null>(null);
  const [selectedShippingQuote, setSelectedShippingQuote] =
    useState<ShippingQuote | null>(null);
  const [shippingSessionId, setShippingSessionId] = useState<string>('');
  const [appliedDiscount, setAppliedDiscount] = useState<DiscountResult | null>(
    null
  );
  const [paymentSettings, setPaymentSettings] =
    useState<PaymentGatewaySettings>(DEFAULT_PAYMENT_SETTINGS);
  const [selectedGateway, setSelectedGateway] = useState<
    'paystack' | 'korapay' | 'pod' | 'credit_direct'
  >('paystack');
  const totalSteps = 2;
  const supabase = createClient();

  // Load Credit Direct script when BNPL is enabled. The injected <script> tag
  // is the source of truth for "already loaded" — guarding on its presence in
  // the DOM avoids a synchronous setState cascade inside the effect body.
  useEffect(() => {
    if (!paymentSettings.creditDirectEnabled) return;

    const existingScript = document.querySelector(
      'script[src="https://checkout.creditdirect.ng/bnpl/checkout.min.js"]'
    );
    if (existingScript) return;

    const script = document.createElement('script');
    script.src = 'https://checkout.creditdirect.ng/bnpl/checkout.min.js';
    script.type = 'application/javascript';
    script.async = true;
    script.onerror = () =>
      console.error('Failed to load Credit Direct checkout script');
    document.body.appendChild(script);
  }, [paymentSettings.creditDirectEnabled]);

  // Handle shipping quote selection
  const handleShippingSelect = (quote: ShippingQuote, sessionId: string) => {
    setSelectedShippingQuote(quote);
    setShippingSessionId(sessionId);
    setShippingFee(quote.price);
  };

  // Calculate discount amount
  const discountAmount = appliedDiscount
    ? // Prefer the server-computed amount (caps + rounding aligned with the
      // route/RPC); fall back to a local estimate only if it's missing.
      (appliedDiscount.discount_amount ??
      (appliedDiscount.discount_type === 'percentage'
        ? Math.round(cartTotal * (appliedDiscount.discount_value / 100))
        : Math.min(appliedDiscount.discount_value, cartTotal)))
    : 0;

  // Calculate loyalty points (1 point per 100 NGN spent)
  const _loyaltyPointsEarned = Math.floor((cartTotal - discountAmount) / 100);

  useEffect(() => {
    const checkUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser(data.user);

        // Also fetch customer data for this merchant if logged in
        if (merchantSlug) {
          try {
            const response = await fetch(
              `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
            );
            const sessionData = await response.json();
            if (sessionData.authenticated && sessionData.customer) {
              setCustomerData(sessionData.customer);
            }
          } catch (err) {
            console.error('Failed to fetch customer data:', err);
          }
        }

        setStep(1); // User is logged in, skip to shipping
      }
      setPageLoading(false);
    };
    checkUser();
  }, [supabase.auth, merchantSlug]);

  // Fetch payment gateway settings
  useEffect(() => {
    const fetchPaymentSettings = async () => {
      if (!merchant?.id) return;

      try {
        const response = await fetch(
          `/api/storefront/features?merchantId=${merchant.id}`
        );
        if (response.ok) {
          const data = await response.json();
          setPaymentSettings({
            paystackEnabled: data.paystackEnabled ?? true,
            korapayEnabled: data.korapayEnabled ?? true,
            payOnDeliveryEnabled: data.payOnDeliveryEnabled ?? false,
            creditDirectEnabled: data.creditDirectEnabled ?? false,
            creditDirectMinAmount: data.creditDirectMinAmount ?? 10000,
            creditDirectMaxAmount: data.creditDirectMaxAmount ?? 500000,
            preferredLocalGateway: data.preferredLocalGateway || 'paystack',
            preferredInternationalGateway:
              data.preferredInternationalGateway || 'korapay',
          });
          // Set initial selected gateway based on preference
          const preferred = data.preferredLocalGateway || 'paystack';
          if (
            (preferred === 'paystack' && data.paystackEnabled) ||
            (preferred === 'korapay' && data.korapayEnabled)
          ) {
            setSelectedGateway(preferred);
          } else if (data.paystackEnabled) {
            setSelectedGateway('paystack');
          } else if (data.korapayEnabled) {
            setSelectedGateway('korapay');
          } else if (data.payOnDeliveryEnabled) {
            setSelectedGateway('pod');
          }
        }
      } catch (error) {
        console.error('Failed to fetch payment settings:', error);
      }
    };

    fetchPaymentSettings();
  }, [merchant?.id]);

  const shippingForm = useForm<z.infer<typeof shippingSchema>>({
    resolver: zodResolver(shippingSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: user?.email || '',
      phone: '',
      address: '',
      city: '',
      state: '',
    },
    mode: 'onSubmit', // Only validate on submit - best practice for checkout
  });

  useEffect(() => {
    // If user changes, autofill email and name fields from user metadata or customer data
    if (user) {
      shippingForm.setValue('email', user.email || '', {
        shouldValidate: true,
        shouldDirty: true,
      });

      // First, try to fill from customer data (more up-to-date)
      if (customerData) {
        if (customerData.first_name) {
          shippingForm.setValue('firstName', customerData.first_name, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }
        if (customerData.last_name) {
          shippingForm.setValue('lastName', customerData.last_name, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }
        if (customerData.phone) {
          shippingForm.setValue('phone', customerData.phone, {
            shouldValidate: true,
            shouldDirty: true,
          });
        }

        // Use default saved address if available
        const defaultAddress = customerData.saved_addresses?.find(
          (a) => a.is_default
        );
        if (defaultAddress) {
          shippingForm.setValue('address', defaultAddress.address, {
            shouldValidate: true,
            shouldDirty: true,
          });
          shippingForm.setValue('city', defaultAddress.city, {
            shouldValidate: true,
            shouldDirty: true,
          });
          shippingForm.setValue('state', defaultAddress.state, {
            shouldValidate: true,
            shouldDirty: true,
          });
          if (defaultAddress.phone) {
            shippingForm.setValue('phone', defaultAddress.phone, {
              shouldValidate: true,
              shouldDirty: true,
            });
          }
          // Override name with address name if different
          if (defaultAddress.full_name) {
            const nameParts = defaultAddress.full_name.split(' ');
            if (nameParts.length > 0) {
              shippingForm.setValue('firstName', nameParts[0], {
                shouldValidate: true,
                shouldDirty: true,
              });
              if (nameParts.length > 1) {
                shippingForm.setValue(
                  'lastName',
                  nameParts.slice(1).join(' '),
                  { shouldValidate: true, shouldDirty: true }
                );
              }
            }
          }
        }
      } else {
        // Fall back to user metadata
        const metadata = user.user_metadata;
        if (metadata) {
          if (metadata.first_name) {
            shippingForm.setValue('firstName', metadata.first_name, {
              shouldValidate: true,
              shouldDirty: true,
            });
          } else if (metadata.full_name) {
            // Try to split full_name if first_name is not available
            const nameParts = metadata.full_name.split(' ');
            if (nameParts.length > 0) {
              shippingForm.setValue('firstName', nameParts[0], {
                shouldValidate: true,
                shouldDirty: true,
              });
              if (nameParts.length > 1) {
                shippingForm.setValue(
                  'lastName',
                  nameParts.slice(1).join(' '),
                  { shouldValidate: true, shouldDirty: true }
                );
              }
            }
          } else if (metadata.name) {
            const parts = metadata.name.split(' ');
            shippingForm.setValue('firstName', parts[0] || '', {
              shouldValidate: true,
              shouldDirty: true,
            });
            shippingForm.setValue('lastName', parts.slice(1).join(' ') || '', {
              shouldValidate: true,
              shouldDirty: true,
            });
          }

          if (metadata.last_name) {
            shippingForm.setValue('lastName', metadata.last_name, {
              shouldValidate: true,
              shouldDirty: true,
            });
          }
        }
      }
    }
  }, [user, customerData, shippingForm]);

  useEffect(() => {
    // Redirect if cart is empty after initial load
    if (cartCount === 0 && !pageLoading) {
      router.replace('/');
    }
  }, [cartCount, pageLoading, router]);

  const handleAuthSuccess = (
    authedUser: SupabaseUser,
    customer?: CustomerData
  ) => {
    setUser(authedUser);
    if (customer) {
      setCustomerData(customer);
    }
    setIsGuestCheckout(false);
    setStep(1);
  };

  const handleGuestCheckout = () => {
    setIsGuestCheckout(true);
    setStep(1);
  };

  const handleNext = async () => {
    const isValid = await shippingForm.trigger();

    // Check if shipping is selected for step 1
    if (step === 1 && !selectedShippingQuote) {
      toast({
        variant: 'destructive',
        title: 'Shipping Required',
        description: 'Please select a shipping option to continue.',
      });
      return;
    }

    if (isValid && step < totalSteps) {
      // Track begin_checkout when moving to payment step
      if (step === 1 && merchant?.id) {
        // Client-side tracking
        trackEvent.beginCheckout(
          merchant.id,
          cart.map((item) => ({ product: item, quantity: item.quantity })),
          currencyCode // Merchant-resolved currency (payout_currency → country → NGN)
        );

        // Server-side tracking for GA4, Facebook, TikTok, Snapchat
        trackServerSideBeginCheckout(
          merchant.id,
          cartTotal,
          currencyCode,
          cart.map((item) => {
            const itemCategory =
              item.categories?.name || item.category || 'General';
            return {
              id: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              category: itemCategory,
            };
          }),
          undefined,
          { eventSourceUrl: window.location.href }
        ).catch((err) => {
          console.warn('Server-side analytics error:', err);
        });
      }
      setStep(step + 1);
    }
  };

  const handlePrev = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };
  // Open the Credit Direct BNPL popup. The popup callbacks own the rest of the
  // flow, so this returns once the popup is wired up.
  const openCreditDirectPopup = (
    order: Record<string, unknown>,
    sign: CreditDirectSignResult,
    orderItems: ReturnType<typeof buildCheckoutOrderItems>,
    data: ShippingFormValues
  ) => {
    // SDK orchestration (guard, transaction build, fail-closed handling, cancel
    // wiring, open) lives in the focused helper; the page injects its own
    // success/popup handlers which need order/merchant/router context.
    openLegacyCreditDirectPopup({
      sign,
      orderId: order.id as string,
      orderItems,
      customerEmail: data.email,
      customerPhone: data.phone,
      connect: window.Connect,
      toast,
      setLoading: setFormIsLoading,
      onSuccess: (response) => {
        if (typeof order.id !== 'string' || !order.id) {
          console.error('Credit Direct client completion skipped:', {
            orderId: order.id,
          });
          return;
        }

        handoffLegacyCreditDirectSuccess({
          orderId: order.id,
          signedSessionId: sign.sessionId,
          checkoutTransactionId: response?.checkoutTransactionId,
          trackingToken:
            typeof order.tracking_token === 'string'
              ? order.tracking_token
              : null,
          customerEmail: data.email,
          merchantSlug: merchantSlug || merchant?.slug || '',
          basePath,
          navigate: router.push,
        });
      },
      onPopup: async (response) => {
        if (typeof order.id !== 'string' || !order.id) {
          console.error('Credit Direct payment reference update skipped:', {
            orderId: order.id,
          });
          toast({
            title: 'Payment reference not saved',
            description: 'Order identifier is missing for reconciliation.',
            variant: 'destructive',
          });
          return;
        }

        const paymentReferenceError = await captureLegacyCreditDirectPopup({
          checkoutTransactionId: response?.checkoutTransactionId,
          orderId: order.id,
          signedSessionId: sign.sessionId,
          updatePaymentReference: updateCreditDirectPaymentReferenceWithRetry,
        });

        if (paymentReferenceError) {
          console.error('Credit Direct payment reference update failed:', {
            error: paymentReferenceError,
            orderId: order.id,
          });
          toast({
            title: 'Payment reference not saved',
            description: paymentReferenceError,
            variant: 'destructive',
          });
        }
      },
    });
  };

  const onShippingSubmit = async (data: ShippingFormValues) => {
    setFormIsLoading(true);

    // Get merchant ID from context (useMerchant hook)
    if (!merchant?.id) {
      toast({
        variant: 'destructive',
        title: 'Order Failed',
        description:
          'Merchant information not available. Please refresh the page and try again.',
      });
      setFormIsLoading(false);
      return;
    }

    // B3 review fix (PR #1611): block order submission when no
    // shipping quote is selected. Pre-fix this sent
    // `shipping_provider: null + selected_quote_id: null`, which
    // slips past the RPC's `provider != null AND quote_id IS NULL`
    // guard (both null → guard doesn't fire) and persists a silent
    // zero-shipping order. The `handleNext` guard at step 1 catches
    // most cases, but a stale quote between step transitions (rates
    // refresh, the previously-selected quote gets invalidated) can
    // leave us here with `selectedShippingQuote = null`. Fail closed
    // at the submit-time boundary too.
    if (!selectedShippingQuote) {
      toast({
        variant: 'destructive',
        title: 'Shipping Required',
        description: 'Please select a shipping option to continue.',
      });
      setFormIsLoading(false);
      setStep(1);
      return;
    }

    const result = await prepareCheckout({
      merchantId: merchant.id,
      data,
      cart,
      cartTotal,
      shippingFee,
      selectedGateway,
      selectedShippingQuote,
      shippingSessionId,
      currencyCode,
      merchantSlug,
      discountCode: appliedDiscount?.code ?? null,
    });

    if (result.kind === 'error') {
      toast({
        variant: 'destructive',
        title: result.title,
        description: result.message,
      });
      setFormIsLoading(false);
      return;
    }

    if (result.kind === 'credit_direct') {
      // Popup callbacks drive the rest of the flow — don't proceed to the
      // success page yet. Matching the prior behavior, the submit spinner is
      // cleared now; the popup's onClose re-clears it if reopened.
      openCreditDirectPopup(result.order, result.sign, result.orderItems, data);
      setFormIsLoading(false);
      return;
    }

    toast({
      title: 'Order Placed!',
      description: `Order ${result.order.order_number} has been placed.`,
    });

    clearCart();

    // Redirect to Paystack/Korapay for payment
    if (result.paystackAuthUrl && selectedGateway !== 'pod') {
      redirectToExternalUrl(result.paystackAuthUrl);
      setFormIsLoading(false);
      return;
    }

    // Fallback for demo/testing if no URL returned or if POD
    router.push(`/checkout/success?orderId=${result.order.id}`);
    setFormIsLoading(false);
  };

  const getStepTitle = () => {
    if (step === 0) return 'Authentication';
    if (step === 1) return 'Shipping Information';
    return 'Payment';
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background py-10 px-4">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 w-full h-full bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('/grid.svg')] bg-center mask-[linear-gradient(180deg,white,rgba(255,255,255,0))]" />

      {/* Animated Orbs */}
      <div
        className="absolute top-1/4 left-1/4 size-96 bg-primary/20 rounded-full blur-3xl animate-pulse"
        style={{ animationDuration: '4s' }}
      />
      <div
        className="absolute bottom-1/4 right-1/4 size-96 bg-accent/20 rounded-full blur-3xl animate-pulse"
        style={{ animationDuration: '6s' }}
      />

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Checkout Form */}
          <div className="lg:col-span-7">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/60 dark:bg-black/40 backdrop-blur-xl shadow-2xl">
              {/* Glass Shine Effect */}
              <div className="absolute inset-0 bg-linear-to-br from-white/20 via-transparent to-transparent pointer-events-none" />

              <div className="relative p-6 md:p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    {/* biome-ignore lint/suspicious/noExplicitAny: Dynamic route handling */}
                    <Link href={`${basePath || ''}/cart` as any}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full hover:bg-white/10"
                      >
                        <ArrowLeft className="size-5" />
                      </Button>
                    </Link>
                    <h1 className="text-2xl font-bold tracking-tight">
                      Checkout
                    </h1>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    Step {step + 1} of {totalSteps + 1}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-8">
                  <CheckoutProgress
                    currentStep={step + 1}
                    steps={[
                      {
                        label: 'Authentication',
                        description: 'Sign in or Sign up',
                      },
                      { label: 'Shipping', description: 'Delivery details' },
                      { label: 'Payment', description: 'Complete order' },
                    ]}
                  />
                </div>

                {/* Form Content with Animation */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="space-y-6">
                      <h2 className="text-xl font-semibold">
                        {getStepTitle()}
                      </h2>

                      {step === 0 && (
                        <Step0_Auth
                          onAuthSuccess={handleAuthSuccess}
                          onGuestCheckout={handleGuestCheckout}
                          merchantSlug={merchantSlug || merchant?.slug || ''}
                        />
                      )}

                      {step === 1 && (
                        <FormProvider {...shippingForm}>
                          <form className="space-y-6">
                            <Step1_Shipping
                              onShippingSelect={handleShippingSelect}
                              selectedQuote={selectedShippingQuote}
                            />
                            <div className="flex justify-end pt-4">
                              <ThemedButton
                                type="button"
                                onClick={handleNext}
                                disabled={!selectedShippingQuote}
                                className="w-full md:w-auto min-w-[150px] h-11 shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
                              >
                                Continue to Payment
                              </ThemedButton>
                            </div>
                          </form>
                        </FormProvider>
                      )}

                      {step === 2 && (
                        <div className="space-y-6">
                          <Step2_Payment
                            selectedQuote={selectedShippingQuote}
                            paymentSettings={paymentSettings}
                            selectedGateway={selectedGateway}
                            onGatewaySelect={setSelectedGateway}
                            orderTotal={
                              cartTotal + (shippingFee ?? 0) - discountAmount
                            }
                          />
                          <div className="flex gap-3 pt-4">
                            <Button
                              variant="outline"
                              onClick={handlePrev}
                              className="flex-1 h-11 bg-white/50 dark:bg-black/20 border-primary/10 hover:bg-white/80"
                            >
                              Back
                            </Button>
                            <ThemedButton
                              onClick={shippingForm.handleSubmit(
                                onShippingSubmit
                              )}
                              disabled={formIsLoading}
                              className="flex-1 h-11 shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
                            >
                              {formIsLoading ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                              ) : selectedGateway === 'pod' ? (
                                <Truck className="mr-2 size-4" />
                              ) : (
                                <CreditCard className="mr-2 size-4" />
                              )}
                              {selectedGateway === 'pod'
                                ? 'Place Order'
                                : `Pay ${formatCurrency(
                                    cartTotal +
                                      (shippingFee || 0) -
                                      discountAmount
                                  )}`}
                            </ThemedButton>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right Column: Order Summary */}
          <div className="lg:col-span-5 space-y-6">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/60 dark:bg-black/40 backdrop-blur-xl shadow-xl sticky top-8">
              <div className="absolute inset-0 bg-linear-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
              <div className="relative p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                  <Sparkles className="size-5 text-primary" />
                  Order Summary
                </h2>

                <OrderSummary
                  shippingFee={shippingFee ?? undefined}
                  discountAmount={discountAmount}
                  discountCode={appliedDiscount?.code}
                />

                <div className="mt-6 pt-6 border-t border-dashed border-primary/20">
                  <DiscountCodeInput
                    merchantId={merchant?.id || ''}
                    cartTotal={cartTotal}
                    currencyCountryCode={merchant?.country ?? 'NG'}
                    payoutCurrency={merchant?.payout_currency ?? null}
                    productIds={cart.map((item) => item.id)}
                    onApply={(result) => setAppliedDiscount(result)}
                    onRemove={() => setAppliedDiscount(null)}
                    appliedDiscount={appliedDiscount}
                  />
                </div>

                {/* Trust Badges / Info */}
                <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 bg-white/30 dark:bg-black/20 p-3 rounded-xl">
                    <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded-full text-green-600">
                      <svg
                        className="size-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    </div>
                    <span>Secure Checkout</span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/30 dark:bg-black/20 p-3 rounded-xl">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600">
                      <Truck className="size-3" />
                    </div>
                    <span>Fast Delivery</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Detect routing mode from the URL: path-based when the pathname is prefixed
// with the merchant slug (e.g. /ogabassey/checkout), otherwise domain-based
// (custom domain or root). Falls back to 'path' during SSR where there is no
// window — the wrapper upgrades it after mount.
function detectRoutingMode(merchantSlug: string | null): 'domain' | 'path' {
  if (typeof window === 'undefined') return 'path';
  const pathname = window.location.pathname;
  if (
    merchantSlug &&
    (pathname === `/${merchantSlug}` ||
      pathname.startsWith(`/${merchantSlug}/`))
  ) {
    return 'path';
  }
  return 'domain';
}

const subscribeRoutingMode = () => () => {
  // Routing mode is static for the page lifetime: nothing to unsubscribe.
};

function CheckoutPageWrapper() {
  const { merchantSlug } = useCart();

  // Read the URL-derived routing mode via useSyncExternalStore so the server
  // snapshot ('path') matches the first client render (avoiding a hydration
  // mismatch) and React swaps in the real value after hydration — no
  // synchronous setState in an effect.
  const routingMode = useSyncExternalStore(
    subscribeRoutingMode,
    () => detectRoutingMode(merchantSlug),
    () => 'path' as const
  );

  return (
    <MerchantProvider
      slug={merchantSlug || undefined}
      initialRoutingMode={routingMode}
    >
      <CheckoutThemeProvider>
        <CheckoutPageContent />
      </CheckoutThemeProvider>
    </MerchantProvider>
  );
}

export default function CheckoutPage() {
  return <CheckoutPageWrapper />;
}
