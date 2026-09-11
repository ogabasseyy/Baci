import {
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Sparkles,
  Star,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { MetricCard } from '@/components/landing/metric-card';
import { TypingAnimation } from '@/components/landing/typing-animation';
import { PlatformFooter } from '@/components/platform/footer';
import { PlatformHeader } from '@/components/platform/header';
import { Button } from '@/components/ui/button';
import { BaciLandingFaqs } from './baci-landing-faqs';
import { BaciLandingFeatures } from './baci-landing-features';
import { PlatformSchemas } from './baci-landing-platform-schemas';

// Interface for metrics
export interface LandingMetrics {
  merchants: number;
  orders: number;
  sales: string | number;
  rating: number;
}

export function BaciLandingPage({ metrics }: { metrics: LandingMetrics }) {
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

        <BaciLandingFeatures />

        <BaciLandingFaqs />
      </main>

      {/* Footer */}
      <PlatformFooter />
    </div>
  );
}
