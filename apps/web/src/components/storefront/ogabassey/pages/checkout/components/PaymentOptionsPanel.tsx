import { Banknote, CalendarDays, FileText, Truck } from 'lucide-react';
import Image from 'next/image';
import creditDirectLogo from '@/../public/partners/credit-direct-filled.png';
import oxygenLogo from '@/../public/partners/oxygen-x-filled.png';
import { useEffect } from 'react';
import {
  BankTransferLogo,
  JuicywayLogo,
  KorapayLogo,
  PaystackLogo,
} from '../../../components/PaymentLogos';
import type { PaymentTab } from '../types';
import type { PaymentOptionsPanelProps } from './payment-options-panel.types';
import { PaymentInstallmentDetails } from './PaymentInstallmentDetails';
import { PaymentOptionCard } from './PaymentOptionCard';
import { PaymentScheduleCard } from './PaymentScheduleCard';
import { FinanceProviderOption } from './FinanceProviderOption';
import {
  RedvaultPaymentOption,
} from './redvault/RedvaultPaymentOption';
import {
  isNgnChargeCurrency,
} from './payment-step-availability';



export function PaymentOptionsPanel({
  paymentTab,
  setPaymentTab,
  paymentMethod,
  setPaymentMethod,
  paystackCheckoutAvailable,
  korapayCheckoutAvailable,
  bankTransferCheckoutAvailable,
  featureSettings,
  klumpEligible,
  oxygenEligible = false,
  hasInstallmentOptions,
  currency,
  redvaultAvailable,
  redvaultStatus,
  redvaultSummary,
}: PaymentOptionsPanelProps) {
  useEffect(() => {
    if (!hasInstallmentOptions && paymentTab === 'installments') {
      // Keep parent tab state aligned with the visible full-payment panel so a
      // later return of installment eligibility cannot jump back while invoice
      // (or another full method) remains selected.
      setPaymentTab('full');
    }
  }, [hasInstallmentOptions, paymentTab, setPaymentTab]);
  const visiblePaymentTab =
    paymentTab === 'installments' && !hasInstallmentOptions
      ? 'full'
      : paymentTab;
  const selectPaymentTab = (nextTab: PaymentTab) => {
    if (nextTab === visiblePaymentTab) return;
    setPaymentTab(nextTab);
    setPaymentMethod('');
  };
  // Juicyway, CredPal, and Credit Direct can only ever charge NGN (see
  // resolveChargeCurrency), so their feature flags alone must not surface
  // them on a non-NGN checkout. Klump is already currency-gated upstream
  // via `klumpEligible` (isKlumpEligible).
  const ngnOnlyRailsAvailable = isNgnChargeCurrency(currency);

  return (
    <div role="group" aria-label="Payment schedule" className="grid gap-3">
      <PaymentScheduleCard title="Pay in Full" subtitle="Pay now — we start processing your order right away" icon={Banknote} selected={visiblePaymentTab === 'full'} onSelect={() => selectPaymentTab('full')}>
        <div className="space-y-3 animate-in fade-in">
          <p className="text-xs text-store-background-text/60">Choose how you'd like to pay:</p>
          <div className="grid grid-cols-1 gap-3">
            {/* Invoice lives on its own "Create Proforma Invoice" tab
              below: a second invoice card here would duplicate it. */}
            <RedvaultPaymentOption
              available={redvaultAvailable}
              onSelect={() => setPaymentMethod('uba_redvault')}
              selected={paymentMethod === 'uba_redvault'}
              status={redvaultStatus}
              summary={redvaultSummary}
            />
            {paystackCheckoutAvailable && (
              <PaymentOptionCard
                method="paystack"
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                title="Paystack"
                description="Card, Bank Transfer, USSD"
                badge={{
                  label: 'Popular',
                  className: 'bg-store-primary/10 text-store-primary',
                }}
                icon={<PaystackLogo className="size-6" />}
              />
            )}
            {bankTransferCheckoutAvailable && (
              <PaymentOptionCard
                method="bank_transfer"
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                title="Bank Transfer"
                description="Pay to a unique virtual account"
                badge={{
                  label: 'Automatic',
                  className: 'bg-store-primary/10 text-store-primary',
                }}
                icon={<BankTransferLogo className="size-6" />}
              />
            )}
            {korapayCheckoutAvailable && (
              <PaymentOptionCard
                method="korapay"
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                title="Korapay"
                description="Card payments across Africa"
                icon={<KorapayLogo className="size-6" />}
              />
            )}
            {featureSettings?.juicyway_enabled === true &&
              ngnOnlyRailsAvailable && (
                <PaymentOptionCard
                  method="juicyway"
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  title="Juicyway"
                  description="USDT, USDC etc"
                  badge={{
                    label: 'Crypto',
                    className: 'bg-store-primary/10 text-store-primary',
                  }}
                  icon={<JuicywayLogo className="size-6" />}
                />
              )}
            {featureSettings?.pay_on_delivery_enabled === true && (
              <PaymentOptionCard
                method="pod"
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                title="Pay on Delivery"
                description="Pay when you receive your items"
                icon={
                  <div className="size-8 bg-store-background-text/10 rounded-lg flex items-center justify-center">
                    <Truck size={16} className="text-store-background-text/70" />
                  </div>
                }
              />
            )}
          </div>
        </div>
      </PaymentScheduleCard>
      {hasInstallmentOptions && <PaymentScheduleCard title="Pay Small Small" subtitle="Split your payment into monthly installments" icon={CalendarDays} selected={visiblePaymentTab === 'installments'} onSelect={() => selectPaymentTab('installments')}>
        <div className="space-y-3 animate-in fade-in">
          <p className="text-xs text-store-background-text/60">Flexible payment options:</p>
          <div className="grid grid-cols-1 gap-3">
            {oxygenEligible && (
              <FinanceProviderOption provider="oxygen" selected={paymentMethod === 'oxygen'} onSelect={setPaymentMethod} logo={oxygenLogo} />
            )}
            {featureSettings?.credit_direct_enabled === true && ngnOnlyRailsAvailable && (
              <FinanceProviderOption provider="credit_direct" selected={paymentMethod === 'credit_direct'} onSelect={setPaymentMethod} logo={creditDirectLogo} />
            )}
            {klumpEligible && (
              <PaymentOptionCard
                method="klump"
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                title="Klump"
                description="Split payment at checkout"
                badge={{
                  label: 'Split payments',
                  className: 'bg-store-primary/10 text-store-primary',
                }}
                icon={
                  <div className="size-8 bg-store-primary/5 rounded-lg flex items-center justify-center text-xs font-black text-store-primary">
                    K
                  </div>
                }
              />
            )}
          </div>

          {paymentMethod !== 'credit_direct' && <PaymentInstallmentDetails paymentMethod={paymentMethod} />}
        </div>
      </PaymentScheduleCard>}
      <PaymentScheduleCard title="Create Proforma Invoice" subtitle="Send it to your company" icon={FileText} selected={visiblePaymentTab === 'invoice'} onSelect={() => selectPaymentTab('invoice')}>
        <div className="space-y-3 animate-in fade-in">
          <p className="text-xs text-store-background-text/60">
            Need a document for your company or procurement team?
          </p>
          <div className="grid grid-cols-1 gap-3">
            <PaymentOptionCard
              method="invoice"
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              title="Create Proforma Invoice"
              description="Send it to your company"
              icon={<FileText className="size-6 text-store-foreground" />}
            />
          </div>
        </div>
      </PaymentScheduleCard>
    </div>
  );
}
