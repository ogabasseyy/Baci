import { Check, Sparkles } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import AppBody from '@/components/app-body';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Pricing - Baci',
  description: 'Simple, transparent pricing for your online store.',
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
    description: 'Perfect for testing ideas and small hobby shops.',
    features: [
      '1 Store',
      '10 Products Max',
      'Basic Storefront',
      'Baci Subdomain',
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
    description: 'For growing businesses that need more power.',
    features: [
      'Unlimited Products',
      'Custom Domain',
      'Advanced Analytics',
      'Priority Support',
      'Marketing Tools',
      'No Transaction Fees',
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
    description: 'For scaling enterprises and high-volume sellers.',
    features: [
      'Everything in Pro',
      'Multiple Staff Accounts',
      'Advanced Report Builder',
      'Dedicated Account Manager',
    ],
    cta: 'Contact Sales',
    href: '/contact' as Route,
    variant: 'outline',
  },
];

export default function PricingPage() {
  return (
    <AppBody>
      <div className="flex flex-col min-h-screen bg-background font-sans selection:bg-accent/30">
        <PlatformHeader />
        <main className="flex-1 pt-24 pb-16">
          <section className="container px-4 md:px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 rounded-full text-accent-foreground text-sm font-medium mb-6">
                <Sparkles className="size-4" />
                <span>Simple Pricing</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
                Choose the perfect plan for your business
              </h1>
              <p className="text-xl text-muted-foreground">
                Start for free, upgrade as you grow. No hidden fees.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {PRICING_PLANS.map((plan) => (
                <div
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
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
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
                  <ul className="space-y-4 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <div className="size-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                          <Check className="size-4" />
                        </div>
                        <span className="text-sm">{feature}</span>
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
                </div>
              ))}
            </div>
          </section>
        </main>
        <PlatformFooter />
      </div>
    </AppBody>
  );
}
