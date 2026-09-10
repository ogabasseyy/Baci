import {
  ArrowRight,
  BarChart,
  CheckCircle2,
  DollarSign,
  Palette,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Zap,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import AppBody from '@/components/app-body';
import { FAQItem } from '@/components/landing/faq-item';
import { MetricCard } from '@/components/landing/metric-card';
import { TypingAnimation } from '@/components/landing/typing-animation';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';
import { JsonLd } from '@/components/seo/json-ld';
import { Button } from '@/components/ui/button';
import { PLATFORM_CONFIG } from '@/config/platform';
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  type OrganizationData,
} from '@/lib/seo-utils';
import { getLandingMetrics } from './actions';

const HOMEPAGE_TITLE =
  'Baci - AI E-commerce Store Builder for African Merchants';

export const metadata: Metadata = {
  title: HOMEPAGE_TITLE,
  description: PLATFORM_CONFIG.description,
  alternates: {
    canonical: PLATFORM_CONFIG.url,
  },
  openGraph: {
    title: HOMEPAGE_TITLE,
    description: PLATFORM_CONFIG.description,
    url: PLATFORM_CONFIG.url,
    siteName: PLATFORM_CONFIG.name,
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: `Baci - ${PLATFORM_CONFIG.description}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: HOMEPAGE_TITLE,
    description: PLATFORM_CONFIG.description,
    images: ['/opengraph-image'],
  },
};

/**
 * Platform-level structured data using @graph pattern.
 * Only rendered on the Baci homepage — NOT on merchant storefronts.
 * Includes Organization + WebSite (the two types Google supports without ratings).
 */
function PlatformSchemas() {
  const organizationData: OrganizationData = {
    name: PLATFORM_CONFIG.name,
    url: PLATFORM_CONFIG.url,
    logo: `${PLATFORM_CONFIG.url}${PLATFORM_CONFIG.logo}`,
    description: PLATFORM_CONFIG.description,
    socialMedia: PLATFORM_CONFIG.socialMedia,
  };

  const organizationSchema = generateOrganizationSchema(organizationData);
  const websiteSchema = generateWebSiteSchema(
    PLATFORM_CONFIG.name,
    PLATFORM_CONFIG.url,
    `${PLATFORM_CONFIG.url}/search?q={search_term_string}`
  );

  // Remove @context from individual schemas — @graph provides it once
  const { '@context': _orgCtx, ...orgWithoutContext } = organizationSchema;
  const { '@context': _wsCtx, ...wsWithoutContext } = websiteSchema;

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@graph': [orgWithoutContext, wsWithoutContext],
      }}
    />
  );
}

// Interface for metrics
interface LandingMetrics {
  merchants: number;
  orders: number;
  sales: string | number;
  rating: number;
}

function BaciLandingPage({ metrics }: { metrics: LandingMetrics }) {
  return (
    <div className="flex flex-col min-h-screen bg-background font-sans selection:bg-accent/30">
      {/* Platform-level structured data: Organization + WebSite in @graph */}
      <PlatformSchemas />
      <PlatformHeader />

      <main id="main-content" className="flex-1 pt-16">
        {/* Hero Section */}
        <section className="relative w-full pt-3 pb-7 md:pb-10 lg:pb-14 overflow-hidden bg-linear-to-b from-slate-50 to-white dark:from-slate-950 dark:to-background min-h-[85vh] flex items-center">
          {/* Background Elements - Optimized with radial gradients instead of heavy blur filters */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,var(--theme-accent)_0%,transparent_70%)] opacity-5 -z-10 pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_center,var(--theme-primary)_0%,transparent_70%)] opacity-5 -z-10 pointer-events-none" />

          <div
            className="container relative z-10"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div className="flex flex-col items-center gap-y-8 text-center max-w-5xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-white/10 border border-accent/60 rounded-full text-indigo-900 dark:text-indigo-100 text-sm font-medium shadow-sm backdrop-blur-xs animate-fade-in">
                <Sparkles className="size-4 text-accent" />
                <span>AI-Powered E-commerce Platform</span>
              </div>

              <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-primary dark:text-white leading-[1.3] text-center">
                <span className="block sm:whitespace-nowrap overflow-visible">
                  Build Your <TypingAnimation /> Store
                </span>
                <span className="block sm:whitespace-nowrap mt-2">
                  with Bac
                  <span className="relative inline-block">
                    ı
                    <span
                      className="absolute top-[-0.005em] left-[52%] -translate-x-1/2 size-[0.16em] bg-accent rounded-full"
                      aria-hidden="true"
                    />
                  </span>
                </span>
              </h1>

              <p className="mx-auto max-w-[700px] text-muted-foreground text-base md:text-lg leading-relaxed">
                Launch a professional e-commerce store powered by AI in seconds.
                No coding required. Perfect for retail businesses ready to
                scale.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto pt-4">
                <Button
                  asChild
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground dark:text-indigo-950 text-lg px-8 h-14 rounded-full shadow-xl shadow-primary/20 transition-all hover:shadow-primary/40 hover:-translate-y-1"
                >
                  <Link href="/onboarding">
                    Start Free Trial <ArrowRight className="ml-2 size-5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-2 h-14 px-8 rounded-full text-lg hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all"
                >
                  <Link href="#how-it-works">See How It Works</Link>
                </Button>
              </div>

              {/* Metrics Cards */}
              <div className="w-full max-w-4xl mt-6 pt-4 border-t border-slate-200/60 dark:border-slate-800/60">
                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <MetricCard
                    icon={<Store className="size-5 text-accent" />}
                    label="Active Merchants"
                    value={`${metrics.merchants.toLocaleString()}+`}
                    delay={0.1}
                  />
                  <MetricCard
                    icon={<DollarSign className="size-5 text-green-500" />}
                    label="Sales Processed"
                    value={`$${metrics.sales}`}
                    delay={0.2}
                  />
                  <MetricCard
                    icon={<Star className="size-5 text-yellow-500" />}
                    label="Average Rating"
                    value={`${metrics.rating}/5.0`}
                    delay={0.3}
                  />
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-primary dark:bg-slate-950">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
            <div className="absolute top-0 right-0 size-[600px] bg-accent/20 rounded-full blur-[120px] will-change-transform" />
            <div className="absolute bottom-0 left-0 size-[600px] bg-purple-500/20 rounded-full blur-[120px] will-change-transform" />
          </div>

          <div
            className="container relative z-10"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div className="max-w-4xl mx-auto text-center gap-y-8">
              <h2 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl text-white">
                Ready to launch your empire?
              </h2>
              <p className="text-xl text-white/80 max-w-2xl mx-auto">
                Join thousands of merchants growing their business with Baci.
                Start your 14-day free trial today.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-indigo-950 hover:bg-white/90 text-lg px-8 h-14 rounded-full shadow-xl transition-all hover:scale-105"
                >
                  <Link href="/onboarding">Start Free Trial</Link>
                </Button>
              </div>
              <div className="flex items-center justify-center gap-8 pt-8 text-white/60 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-accent" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-accent" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section
          id="features"
          className="py-24 bg-slate-50 dark:bg-slate-900/50 content-auto contain-intrinsic-size-[1px_1000px]"
        >
          <div
            className="container"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl mb-4 text-primary dark:text-white">
                Everything you need to scale
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Powerful features built for modern commerce, simplified by AI.
              </p>
            </div>

            <ul className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: <Palette className="size-6 text-purple-500" />,
                  title: 'Custom Branding',
                  description:
                    'Upload your logo and let our AI automatically generate a matching color palette and theme.',
                },
                {
                  icon: <Sparkles className="size-6 text-accent" />,
                  title: 'AI-Powered Design',
                  description:
                    'Generate your entire store layout, branding, and copy in seconds with advanced AI.',
                },
                {
                  icon: <ShoppingBag className="size-6 text-blue-500" />,
                  title: 'Smart Inventory',
                  description:
                    'Track stock levels, manage variants, and get low-stock alerts automatically.',
                },
                {
                  icon: <Store className="size-6 text-green-500" />,
                  title: 'Multi-Channel',
                  description:
                    'Sell everywhere - online, social media, and in-person with unified inventory.',
                },
                {
                  icon: <Zap className="size-6 text-yellow-500" />,
                  title: 'Lightning Fast',
                  description:
                    'Built on modern edge infrastructure for sub-second load times globally.',
                },
                {
                  icon: <BarChart className="size-6 text-red-500" />,
                  title: 'Real-time Analytics',
                  description:
                    'Get actionable insights on sales, visitors, and conversion rates instantly.',
                },
              ].map((feature) => (
                <li key={feature.title}>
                  <article className="h-full p-8 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-[transform,box-shadow] duration-200 group">
                    <div className="size-12 rounded-xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-200">
                      {feature.icon}
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-primary dark:text-white">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How It Works Section */}
        <section
          id="how-it-works"
          className="py-24 bg-white dark:bg-slate-950 content-auto contain-intrinsic-size-[1px_800px]"
        >
          <div
            className="container"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl mb-4 text-primary dark:text-white">
                How It Works
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Launch your store in three simple steps. No technical knowledge
                required.
              </p>
            </div>

            <ol className="grid gap-8 md:grid-cols-3 max-w-6xl mx-auto">
              {[
                {
                  step: '1',
                  title: 'Sign Up & Tell Us About Your Business',
                  description:
                    'Answer a few quick questions about your products, brand, and target audience. Our AI will understand your vision.',
                  icon: <Sparkles className="size-8 text-accent" />,
                },
                {
                  step: '2',
                  title: 'AI Generates Your Store',
                  description:
                    'Watch as our AI creates your complete store: product pages, branding, copy, and layout—all optimized for conversions.',
                  icon: <Zap className="size-8 text-accent" />,
                },
                {
                  step: '3',
                  title: 'Customize & Launch',
                  description:
                    "Fine-tune any details you'd like, connect your payment processor, and go live. Start selling in minutes, not months.",
                  icon: <CheckCircle2 className="size-8 text-accent" />,
                },
              ].map((step, i) => (
                <li key={step.step} className="relative">
                  <article className="h-full p-8 rounded-2xl glass border border-slate-200 dark:border-slate-800 group">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="size-16 rounded-2xl bg-accent/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                        {step.icon}
                      </div>
                      <span className="text-6xl font-bold text-accent/20">
                        {step.step}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-primary dark:text-white">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </article>
                  {i < 2 && (
                    <div className="hidden md:flex absolute top-1/2 -right-4 w-12 items-center justify-center transform translate-x-1/2 -translate-y-1/2 z-10">
                      <div className="absolute w-full h-[2px] bg-slate-200 dark:bg-slate-800" />
                      <div className="relative bg-white dark:bg-slate-950 p-1 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm">
                        <ArrowRight className="size-4 text-accent" />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            {/* HowTo Schema */}
            <JsonLd
              data={{
                '@context': 'https://schema.org',
                '@type': 'HowTo',
                name: 'How to Create an E-commerce Store with Baci',
                description:
                  'Launch your professional e-commerce store in three simple steps using AI-powered tools.',
                step: [
                  {
                    '@type': 'HowToStep',
                    position: 1,
                    name: 'Sign Up & Tell Us About Your Business',
                    text: 'Answer a few quick questions about your products, brand, and target audience. Our AI will understand your vision.',
                    url: 'https://baci.app#how-it-works',
                  },
                  {
                    '@type': 'HowToStep',
                    position: 2,
                    name: 'AI Generates Your Store',
                    text: 'Watch as our AI creates your complete store: product pages, branding, copy, and layout—all optimized for conversions.',
                    url: 'https://baci.app#how-it-works',
                  },
                  {
                    '@type': 'HowToStep',
                    position: 3,
                    name: 'Customize & Launch',
                    text: "Fine-tune any details you'd like, connect your payment processor, and go live. Start selling in minutes, not months.",
                    url: 'https://baci.app#how-it-works',
                  },
                ],
                totalTime: 'PT10M',
              }}
            />
          </div>
        </section>

        {/* FAQs Section */}
        <section
          id="faqs"
          className="py-24 bg-slate-50 dark:bg-slate-900/50 content-auto contain-intrinsic-size-[1px_1000px]"
        >
          <div
            className="container"
            style={{
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl mb-4 text-primary dark:text-white">
                Frequently Asked Questions
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Everything you need to know about building your store with Baci.
              </p>
            </div>

            <dl className="max-w-4xl mx-auto space-y-6">
              {[
                {
                  question: 'Do I need coding skills to use Baci?',
                  answer:
                    'Not at all! Baci is designed for everyone. Our AI handles all the technical work—you just answer a few questions about your business, and we create your entire store automatically.',
                },
                {
                  question: 'How long does it take to launch my store?',
                  answer:
                    'Most merchants go live in under 10 minutes. The AI generates your store in seconds, and you can customize and launch immediately. No waiting for developers or designers.',
                },
                {
                  question: 'Can I use my own domain name?',
                  answer:
                    'Yes! You can connect your custom domain or use a free Baci subdomain. We provide step-by-step instructions to connect your domain from providers like GoDaddy, Namecheap, or Google Domains.',
                },
                {
                  question: 'What payment methods can I accept?',
                  answer:
                    'Baci integrates with major payment processors including Stripe, PayPal, and local payment methods. Accept credit cards, debit cards, digital wallets, and more—all with secure, PCI-compliant checkout.',
                },
                {
                  question: 'Is there a free trial?',
                  answer:
                    "Yes! Start with our 14-day free trial. No credit card required. Test all features, build your store, and only pay when you're ready to go live.",
                },
                {
                  question: 'Can I migrate from another platform?',
                  answer:
                    'Absolutely. We offer free migration assistance for stores moving from Shopify, WooCommerce, or other platforms. Our team will help you import your products, customers, and orders seamlessly.',
                },
                {
                  question: 'Do you offer customer support?',
                  answer:
                    'Yes! We provide 24/7 email support for all plans, plus live chat and priority support for premium customers. Our comprehensive knowledge base and video tutorials are also available anytime.',
                },
                {
                  question: 'Can I sell physical and digital products?',
                  answer:
                    'Yes! Baci supports both physical products (with inventory tracking and shipping) and digital products (instant delivery via secure download links). You can sell both types in the same store.',
                },
              ].map((faq) => (
                <FAQItem
                  key={faq.question}
                  question={faq.question}
                  answer={faq.answer}
                />
              ))}
            </dl>

            <div className="mt-12 text-center animate-fade-in">
              <p className="text-muted-foreground mb-4">
                Still have questions? We're here to help.
              </p>
              <Button
                asChild
                variant="outline"
                className="rounded-full border-2 hover:bg-accent/5 hover:text-accent hover:border-accent/50 transition-all"
              >
                <Link href="/contact">Contact Support</Link>
              </Button>
            </div>

            {/* FAQ Schema */}
            <JsonLd
              data={{
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: [
                  {
                    '@type': 'Question',
                    name: 'Do I need coding skills to use Baci?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Not at all! Baci is designed for everyone. Our AI handles all the technical work—you just answer a few questions about your business, and we create your entire store automatically.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'How long does it take to launch my store?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Most merchants go live in under 10 minutes. The AI generates your store in seconds, and you can customize and launch immediately. No waiting for developers or designers.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Can I use my own domain name?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Yes! You can connect your custom domain or use a free Baci subdomain. We provide step-by-step instructions to connect your domain from providers like GoDaddy, Namecheap, or Google Domains.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'What payment methods can I accept?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Baci integrates with major payment processors including Stripe, PayPal, and local payment methods. Accept credit cards, debit cards, digital wallets, and more—all with secure, PCI-compliant checkout.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Is there a free trial?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: "Yes! Start with our 14-day free trial. No credit card required. Test all features, build your store, and only pay when you're ready to go live.",
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Can I migrate from another platform?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Absolutely. We offer free migration assistance for stores moving from Shopify, WooCommerce, or other platforms. Our team will help you import your products, customers, and orders seamlessly.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Do you offer customer support?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Yes! We provide 24/7 email support for all plans, plus live chat and priority support for premium customers. Our comprehensive knowledge base and video tutorials are also available anytime.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Can I sell physical and digital products?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Yes! Baci supports both physical products (with inventory tracking and shipping) and digital products (instant delivery via secure download links). You can sell both types in the same store.',
                    },
                  },
                ],
              }}
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <PlatformFooter />
    </div>
  );
}

export default async function HomePage() {
  // Fetch metrics on the server
  const metrics = await getLandingMetrics();

  return (
    <AppSansFont>
      <AppBody showPlatformAnalytics>
        <BaciLandingPage metrics={metrics} />
      </AppBody>
    </AppSansFont>
  );
}
