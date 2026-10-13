import {
  ArrowRight,
  BarChart,
  CheckCircle2,
  Palette,
  ShoppingBag,
  Sparkles,
  Store,
  Zap,
} from 'lucide-react';
import { JsonLd } from '@/components/seo/json-ld';

export function BaciLandingFeatures() {
  return (
    <>
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
    </>
  );
}
