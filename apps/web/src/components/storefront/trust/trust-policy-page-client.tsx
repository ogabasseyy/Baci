import {
  OGABASSEY_ASSURANCE_SUMMARY,
  OGABASSEY_CARE_INTRO,
  OGABASSEY_RETURN_HELP,
  OGABASSEY_RETURN_SUMMARY,
  OGABASSEY_WARRANTY_DETAILS,
  OGABASSEY_WARRANTY_SUMMARY,
} from '@baci/shared';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
  MerchantTrustProfileShippingFeeType,
} from '@/lib/storefront-trust/merchant-trust-profile-types';

import { OgabasseyReturnHighlights } from './ogabassey-return-highlights';
import { OgabasseyReturnShipping } from './ogabassey-return-shipping';
import { getPolicyGuidance } from './trust-policy-guidance';

export type TrustPolicyKind = 'returns' | 'shipping' | 'warranty';

export interface TrustPolicyPageClientProps {
  ogabasseyCare?: boolean;
  kind: TrustPolicyKind;
  merchantName: string;
  contactHref?: string;
  trustProfile: MerchantTrustProfile;
}

function formatReturnMethod(method?: MerchantTrustProfileReturnMethod): string {
  switch (method) {
    case 'mail':
      return 'Mail';
    case 'in_store':
      return 'In store';
    case 'carrier_dropoff':
      return 'Carrier drop-off';
    default:
      return 'Not specified';
  }
}

function formatReturnFee(fee?: MerchantTrustProfileReturnFee): string {
  switch (fee) {
    case 'free':
      return 'Free';
    case 'customer_pays':
      return 'Customer pays';
    case 'original_shipping_deducted':
      return 'Original shipping deducted';
    default:
      return 'Not specified';
  }
}

function formatShippingFeeType(
  feeType?: MerchantTrustProfileShippingFeeType
): string {
  switch (feeType) {
    case 'free':
      return 'Free';
    case 'flat_rate':
      return 'Flat rate';
    case 'calculated':
      return 'Calculated at checkout';
    default:
      return 'Not specified';
  }
}

function formatDayRange(min?: number, max?: number): string {
  if (min != null && max != null) {
    return min === max ? `${min} business days` : `${min}-${max} business days`;
  }

  if (min != null) {
    return `${min} business days`;
  }

  if (max != null) {
    return `${max} business days`;
  }

  return 'Not specified';
}

function getPolicyTitle(kind: TrustPolicyKind): string {
  switch (kind) {
    case 'returns':
      return 'Returns Policy';
    case 'shipping':
      return 'Shipping Policy';
    case 'warranty':
      return 'Warranty Policy';
  }
}

function getPolicySummary(
  kind: TrustPolicyKind,
  trustProfile: MerchantTrustProfile
): string {
  switch (kind) {
    case 'returns':
      return trustProfile.returnPolicy?.summary || '';
    case 'shipping':
      return trustProfile.shippingPolicy?.summary || '';
    case 'warranty':
      return trustProfile.warrantyPolicy?.summary || '';
  }
}

function getPolicyFacts(
  kind: TrustPolicyKind,
  trustProfile: MerchantTrustProfile
): Array<{ label: string; value: string }> {
  switch (kind) {
    case 'returns':
      return [
        {
          label: 'Return window',
          value:
            trustProfile.returnPolicy?.windowDays != null
              ? `${trustProfile.returnPolicy.windowDays} days`
              : 'Not specified',
        },
        {
          label: 'Return method',
          value: formatReturnMethod(trustProfile.returnPolicy?.returnMethod),
        },
        {
          label: 'Return fees',
          value: formatReturnFee(trustProfile.returnPolicy?.returnFees),
        },
      ];
    case 'shipping':
      return [
        {
          label: 'Regions',
          value:
            trustProfile.shippingPolicy?.regions?.join(', ') || 'Not specified',
        },
        {
          label: 'Handling time',
          value: formatDayRange(
            trustProfile.shippingPolicy?.handlingDaysMin,
            trustProfile.shippingPolicy?.handlingDaysMax
          ),
        },
        {
          label: 'Transit time',
          value: formatDayRange(
            trustProfile.shippingPolicy?.transitDaysMin,
            trustProfile.shippingPolicy?.transitDaysMax
          ),
        },
        {
          label: 'Shipping fees',
          value: formatShippingFeeType(
            trustProfile.shippingPolicy?.shippingFeeType
          ),
        },
      ];
    case 'warranty':
      return [
        {
          label: 'Coverage',
          value: trustProfile.warrantyPolicy?.summary || 'Not specified',
        },
      ];
  }
}

export function TrustPolicyPageClient({
  kind,
  merchantName,
  contactHref,
  trustProfile,
  ogabasseyCare = false,
}: TrustPolicyPageClientProps) {
  const isOgabasseyReturns = ogabasseyCare && kind === 'returns';
  const isOgabasseyWarranty = ogabasseyCare && kind === 'warranty';
  const summary = isOgabasseyReturns
    ? OGABASSEY_RETURN_SUMMARY
    : isOgabasseyWarranty
      ? OGABASSEY_WARRANTY_SUMMARY
      : getPolicySummary(kind, trustProfile);
  const facts =
    isOgabasseyReturns || isOgabasseyWarranty
      ? []
      : getPolicyFacts(kind, trustProfile);
  const guidance = getPolicyGuidance(kind, merchantName, trustProfile);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <section className="rounded-3xl border border-store-border bg-store-background p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-store-background-text/60">
          {merchantName}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-store-background-text sm:text-4xl">
          {getPolicyTitle(kind)}
        </h1>
        {ogabasseyCare && kind === 'returns' && (
          <p className="mt-4 leading-7 text-store-background-text/80">
            {OGABASSEY_CARE_INTRO}
          </p>
        )}
        {summary ? (
          <p className="mt-4 text-base leading-7 text-store-background-text/70">
            {summary}
          </p>
        ) : null}

        {isOgabasseyReturns && (
          <OgabasseyReturnHighlights trustProfile={trustProfile} />
        )}
        <section className="mt-6 rounded-2xl border border-store-border bg-store-background-text/5 p-4">
          <h2 className="text-lg font-semibold text-store-background-text">
            {guidance.heading}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-store-background-text/70 sm:text-base sm:leading-7">
            {(ogabasseyCare
              ? kind === 'returns'
                ? [OGABASSEY_RETURN_HELP]
                : [OGABASSEY_WARRANTY_DETAILS, OGABASSEY_ASSURANCE_SUMMARY]
              : guidance.paragraphs
            ).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        {isOgabasseyReturns && <OgabasseyReturnShipping />}

        {facts.length > 0 && (
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="rounded-2xl border border-store-border bg-store-background-text/5 p-4"
              >
                <dt className="text-sm font-medium text-store-background-text/60">
                  {fact.label}
                </dt>
                <dd className="mt-2 text-base font-medium text-store-background-text">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {contactHref ? (
          <div className="mt-8">
            <a
              href={contactHref}
              className="inline-flex items-center rounded-full border border-store-border px-4 py-2 text-sm font-medium text-store-background-text transition-colors hover:border-store-primary hover:bg-store-background-text/10"
            >
              Contact us
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
