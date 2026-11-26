import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import AppBody from '@/components/app-body';
import { FeatureIcon } from '@/components/landing/feature-icon';
import { RoadmapStrip } from '@/components/landing/roadmap-strip';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';
import { Button } from '@/components/ui/button';
import {
  PLATFORM_FEATURE_CATEGORIES,
  PLATFORM_SPOTLIGHT_FEATURES,
} from '@/config/platform-features';

export const metadata: Metadata = {
  title: 'Features - Baci',
  description:
    'Explore every built-in Baci capability: AI store builder, price negotiations, discount codes, loyalty tiers, Paystack/BNPL/crypto payments, Mobile Admin, and agentic commerce.',
};

export default function FeaturesPage() {
  const totalCapabilities = PLATFORM_FEATURE_CATEGORIES.reduce(
    (sum, category) => sum + category.items.length,
    0
  );

  return (
    <AppBody>
      <div className="flex flex-col min-h-screen bg-background font-sans selection:bg-accent/30">
        <PlatformHeader />
        <main id="main-content" className="flex-1 pt-24 pb-20">
          {/* Header & Spotlight */}
          <section className="container px-4 md:px-6">
            <div className="text-center mb-14 max-w-3xl mx-auto">
              <p className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">
                {totalCapabilities} Built-In Capabilities
              </p>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-primary dark:text-white">
                Everything you need to sell, get paid, and scale
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                From AI storefront creation and price negotiations to discount
                codes, virtual terminals, and mobile inventory management—all in
                one platform.
              </p>
            </div>

            {/* Category Jump Links */}
            <nav
              aria-label="Feature categories"
              className="flex flex-wrap items-center justify-center gap-2 mb-16"
            >
              {PLATFORM_FEATURE_CATEGORIES.map((category) => (
                <a
                  key={category.id}
                  href={`#${category.id}`}
                  className="px-4 py-2 rounded-full text-sm font-medium bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-accent/60 hover:text-primary dark:hover:text-white transition-colors"
                >
                  {category.label}
                </a>
              ))}
            </nav>

            {/* Spotlight Grid */}
            <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
              {PLATFORM_SPOTLIGHT_FEATURES.map((feature) => (
                <li key={feature.id}>
                  <article className="h-full p-8 rounded-2xl border border-border bg-card hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between gap-3 mb-6">
                      <div className="p-3 bg-accent/10 w-fit rounded-xl">
                        <FeatureIcon
                          name={feature.icon}
                          className={feature.iconClassName}
                        />
                      </div>
                      {feature.badge && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent">
                          {feature.badge}
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl font-bold mb-3 text-primary dark:text-white">
                      {feature.title}
                    </h2>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </section>

          {/* Detailed Category Sections */}
          <div className="space-y-16">
            {PLATFORM_FEATURE_CATEGORIES.map((category) => (
              <section
                key={category.id}
                id={category.id}
                className="container px-4 md:px-6 scroll-mt-24"
              >
                <div className="mb-8 max-w-2xl">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary dark:text-white mb-2">
                    {category.label}
                  </h2>
                  <p className="text-muted-foreground text-lg">
                    {category.tagline}
                  </p>
                </div>

                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {category.items.map((item) => (
                    <li key={item.id}>
                      <article className="h-full flex flex-col justify-between p-6 rounded-2xl border border-border bg-card">
                        <div>
                          <div className="flex items-start gap-3 mb-3">
                            <div className="size-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                              <FeatureIcon
                                name={item.icon}
                                className="size-5 text-accent"
                              />
                            </div>
                            <h3 className="text-lg font-semibold text-primary dark:text-white leading-snug">
                              {item.title}
                            </h3>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        <ul
                          aria-label="Available on"
                          className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-border/60"
                        >
                          {item.surfaces.map((surface) => (
                            <li
                              key={surface}
                              className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                            >
                              {surface}
                            </li>
                          ))}
                        </ul>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Upcoming Roadmap */}
          <div className="mt-20">
            <RoadmapStrip />
          </div>

          {/* Bottom CTA */}
          <section className="container px-4 md:px-6 mt-20">
            <div className="rounded-3xl bg-primary dark:bg-slate-900 p-10 md:p-14 text-center text-white">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Ready to run your store on Baci?
              </h2>
              <p className="text-white/80 text-lg max-w-2xl mx-auto mb-8">
                Launch your AI-powered storefront in minutes—with negotiations,
                discount codes, local payments, and mobile admin built right in.
              </p>
              <Button
                asChild
                size="lg"
                className="bg-white text-indigo-950 hover:bg-white/90 text-lg px-8 h-14 rounded-full shadow-xl"
              >
                <Link href="/onboarding">
                  Start Free Trial <ArrowRight className="ml-2 size-5" />
                </Link>
              </Button>
            </div>
          </section>
        </main>
        <PlatformFooter />
      </div>
    </AppBody>
  );
}
