import { Check, Minus, Sparkles } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import AppBody from '@/components/app-body';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Pricing - Baci',
  description:
    'Simple, transparent NGN pricing for your online store—start free and unlock custom domains, Jumia sync, ad CAPI, and multi-branch teams as you grow.',
};

type PricingPlan = {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: readonly string[];
  cta: string;
  href: Route;
  variant: 'default' | 'outline';
  popular?: boolean;
};

const PRICING_PLANS: readonly PricingPlan[] = [
  {
    name: 'Free',
    price: '₦0',
    description: 'Perfect for testing ideas and launching your first store.',
    features: [
      '1 Store + Free Baci Subdomain',
      'Up to 10 Products',
      'AI Storefront & Visual Builder (29+ Blocks)',
      'Paystack, Korapay, Bank Transfer (DVA) & POD',
      'Discount Codes, Price Negotiations & Reviews',
      'Baci Mobile Admin App (iOS & Android)',
      'Standard Support',
    ],
    cta: 'Start Free',
    href: '/onboarding' as Route,
    variant: 'outline',
  },
  {
    name: 'Pro',
    price: '₦5,000',
    period: '/month',
    description: 'For growing businesses that want full marketing & scale.',
    features: [
      'Unlimited Products & Categories',
      'Custom Web Domain + Custom Sender Email',
      'BNPL (CredPal, Credit Direct, Klump) & Crypto',
      'Ad Pixels, Server-Side CAPI & ROAS Sync',
      'Jumia Marketplace Sync & Shopping Feeds',
      'Loyalty Tiers, Blog Engine & AI SEO Tools',
      'Priority Support & No Baci Transaction Fees',
    ],
    cta: 'Get Started',
    href: '/onboarding?plan=pro' as Route,
    variant: 'default',
    popular: true,
  },
  {
    name: 'Premium',
    price: '₦15,000',
    period: '/month',
    description: 'For multi-branch teams and high-volume sellers.',
    features: [
      'Everything in Pro',
      'Multi-Branch Switching & 8-Role Staff RBAC',
      'Branch & Staff Paystack Virtual Terminals',
      'Ship on Credit & Serialized Unit Tracking',
      'Executive Summary & Tax Ledger PDF Reports',
      'Agentic Commerce (UCP/ACP) & API Access',
      'Dedicated Account Manager',
    ],
    cta: 'Contact Sales',
    href: '/contact' as Route,
    variant: 'outline',
  },
];

type ComparisonRow = {
  feature: string;
  free: boolean | string;
  pro: boolean | string;
  premium: boolean | string;
};

const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    feature: 'Products & Catalog',
    free: 'Up to 10',
    pro: 'Unlimited',
    premium: 'Unlimited',
  },
  {
    feature: 'AI Store Builder & 29+ Visual Blocks',
    free: true,
    pro: true,
    premium: true,
  },
  {
    feature: 'Price Negotiations & Discount Codes',
    free: true,
    pro: true,
    premium: true,
  },
  {
    feature: 'Paystack, Korapay, Bank Transfer & POD',
    free: true,
    pro: true,
    premium: true,
  },
  {
    feature: 'Mobile Admin App & Barcode Scanner',
    free: true,
    pro: true,
    premium: true,
  },
  {
    feature: 'Custom Domain & Custom Sender Email',
    free: false,
    pro: true,
    premium: true,
  },
  {
    feature: 'Ad Pixels, Server-Side CAPI & Jumia Sync',
    free: false,
    pro: true,
    premium: true,
  },
  {
    feature: 'BNPL, Crypto Checkout & Loyalty Tiers',
    free: false,
    pro: true,
    premium: true,
  },
  {
    feature: 'Multi-Branch & 8-Role Staff Accounts',
    free: false,
    pro: false,
    premium: true,
  },
  {
    feature: 'Virtual Terminals, Tax Ledgers & API Access',
    free: false,
    pro: false,
    premium: true,
  },
];

function PlanCell({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return (
      <span className="text-sm font-medium text-primary dark:text-white">
        {value}
      </span>
    );
  }
  return value ? (
    <span className="inline-flex size-6 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 items-center justify-center">
      <Check className="size-4" aria-label="Included" />
    </span>
  ) : (
    <span className="inline-flex size-6 items-center justify-center text-muted-foreground/50">
      <Minus className="size-4" aria-label="Not included" />
    </span>
  );
}

export default function PricingPage() {
  return (
    <AppBody>
      <div className="flex flex-col min-h-screen bg-background font-sans selection:bg-accent/30">
        <PlatformHeader />
        <main id="main-content" className="flex-1 pt-24 pb-20">
          <section className="container px-4 md:px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 rounded-full text-accent-foreground text-sm font-medium mb-6">
                <Sparkles className="size-4" aria-hidden="true" />
                <span>Simple Pricing</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-primary dark:text-white">
                Choose the perfect plan for your business
              </h1>
              <p className="text-xl text-muted-foreground">
                Start for free, upgrade as you grow. No hidden fees.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {PRICING_PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative p-8 rounded-2xl border ${
                    plan.popular
                      ? 'border-primary shadow-lg shadow-primary/10 bg-card'
                      : 'border-border bg-card/50'
                  } flex flex-col`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-medium">
                      Most Popular
                    </div>
                  )}
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold mb-2">{plan.name}</h2>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-4xl font-bold">{plan.price}</span>
                      {plan.period && (
                        <span className="text-muted-foreground">
                          {plan.period}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground">{plan.description}</p>
                  </div>
                  <ul className="space-y-3.5 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <div className="size-5 mt-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Check className="size-3.5" aria-hidden="true" />
                        </div>
                        <span className="text-sm leading-snug">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    variant={plan.variant}
                    size="lg"
                    className="w-full"
                  >
                    <Link href={plan.href}>{plan.cta}</Link>
                  </Button>
                </article>
              ))}
            </div>
          </section>

          {/* Feature Comparison Matrix */}
          <section className="container px-4 md:px-6 mt-20 max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary dark:text-white mb-2">
                Compare plan capabilities
              </h2>
              <p className="text-muted-foreground">
                Want the complete list?{' '}
                <Link
                  href="/features"
                  className="font-semibold text-accent hover:underline"
                >
                  Explore all 35 built-in capabilities
                </Link>
                .
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-slate-50/80 dark:bg-slate-900/60">
                    <th className="py-4 px-5 text-sm font-semibold text-primary dark:text-white">
                      Capability
                    </th>
                    <th className="py-4 px-4 text-sm font-semibold text-center text-primary dark:text-white">
                      Free
                    </th>
                    <th className="py-4 px-4 text-sm font-semibold text-center text-primary dark:text-white">
                      Pro
                    </th>
                    <th className="py-4 px-4 text-sm font-semibold text-center text-primary dark:text-white">
                      Premium
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.feature}>
                      <td className="py-3.5 px-5 text-sm text-foreground">
                        {row.feature}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <PlanCell value={row.free} />
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <PlanCell value={row.pro} />
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <PlanCell value={row.premium} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
        <PlatformFooter />
      </div>
    </AppBody>
  );
}
