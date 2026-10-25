import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
  MerchantTrustProfileShippingFeeType,
} from '@/lib/storefront-trust/merchant-trust-profile-types';

export type TrustPolicyKind = 'returns' | 'shipping' | 'warranty';

export interface TrustPolicyPageClientProps {
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
      return 'Calculated';
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

function hasConfiguredReturnPolicy(
  trustProfile: MerchantTrustProfile
): boolean {
  const returnPolicy = trustProfile.returnPolicy;
  return Boolean(
    returnPolicy &&
      (returnPolicy.summary?.trim() ||
        returnPolicy.windowDays != null ||
        returnPolicy.returnMethod ||
        returnPolicy.returnFees)
  );
}

function getPolicyGuidance(
  kind: TrustPolicyKind,
  merchantName: string,
  trustProfile: MerchantTrustProfile
): { heading: string; paragraphs: string[] } {
  switch (kind) {
    case 'returns': {
      if (!hasConfiguredReturnPolicy(trustProfile)) {
        return {
          heading: 'Before you contact support about a return',
          paragraphs: [
            `Return details for ${merchantName} are not fully specified on this page yet. Contact support before sending any item back so the team can confirm eligibility, required evidence and the correct return address or process.`,
            'Keep your order number, receipt, product photos and packaging information available. Clear details help support confirm the next step without creating return instructions that are not backed by the merchant policy.',
          ],
        };
      }

      return {
        heading: 'Before you request a return',
        paragraphs: [
          `Use this page to confirm the current return window, accepted return method and any return fees before sending an item back to ${merchantName}. Keep the order number, receipt, original accessories and product packaging ready so support can verify the request quickly.`,
          'Inspect the item as soon as it arrives. Report defects or delivery damage early, keep product packaging where possible, and contact support before dispatching anything to prevent avoidable delays.',
        ],
      };
    }
    case 'shipping':
      return {
        heading: 'How delivery works',
        paragraphs: [
          `Use this page to confirm the delivery regions, handling time, transit estimate and shipping fee method for ${merchantName}. Delivery timing can depend on stock status, payment confirmation, destination city and courier availability.`,
          'Before checkout, confirm the exact delivery address, recipient phone number and selected product variant. For high-value orders, keep the order reference available and inspect the package at delivery before accepting it where possible.',
        ],
      };
    case 'warranty':
      return {
        heading: 'How warranty support works',
        paragraphs: [
          `Use this page to confirm the warranty coverage available from ${merchantName} before you complete a purchase or request service support. Read the published coverage and exclusions, and contact support if you need clarification for your device.`,
          'Keep your order receipt, product identifier where applicable and photos or videos showing the fault. Support can explain the claim process and the coverage stated in the published warranty policy.',
        ],
      };
  }
}

export function TrustPolicyPageClient({
  kind,
  merchantName,
  contactHref,
  trustProfile,
}: TrustPolicyPageClientProps) {
  const summary = getPolicySummary(kind, trustProfile);
  const facts = getPolicyFacts(kind, trustProfile);
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
        {summary ? (
          <p className="mt-4 text-base leading-7 text-store-background-text/70">
            {summary}
          </p>
        ) : null}

        <section className="mt-6 rounded-2xl border border-store-border bg-store-background-text/5 p-4">
          <h2 className="text-lg font-semibold text-store-background-text">
            {guidance.heading}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-store-background-text/70 sm:text-base sm:leading-7">
            {guidance.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

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
