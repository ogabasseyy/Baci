import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { ThemedButton } from '@/components/themed';
import type { IndustryTheme } from '@/hooks/use-industry-theme';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getGadgetHeroImage } from './get-gadget-hero-image';

export interface GadgetDefaultHeroProps {
  businessName?: string | null;
  businessType?: string | null;
  basePath?: string | null;
  theme: IndustryTheme;
  radiusClass: string;
}

export function GadgetDefaultHero({
  businessName,
  businessType,
  basePath,
  theme,
  radiusClass,
}: GadgetDefaultHeroProps) {
  const heroImage = getGadgetHeroImage(businessType);
  const getFullHref = (path: string) =>
    `${basePath || ''}${path === '/' ? '' : path}`;

  return (
    <section className="relative overflow-hidden">
      {theme.layout.hero === 'full' ? (
        <div className="relative h-[600px] w-full">
          <Image
            src={heroImage}
            alt="Hero"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-center p-6">
            <div className="max-w-2xl text-white space-y-6">
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
                {businessName || 'Welcome to Store'}
              </h1>
              <p className="text-xl md:text-2xl font-light opacity-90">
                Discover our premium collection tailored just for you.
              </p>
              <ThemedButton
                asChild
                size="lg"
                colorRole="primary"
                className={cn(
                  'px-8 py-4 text-lg font-medium transition-transform hover:scale-105',
                  radiusClass
                )}
              >
                <Link href={asRoute(getFullHref('/products'))}>Shop Now</Link>
              </ThemedButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="container mx-auto px-4 py-12 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <h1
                className="text-5xl md:text-7xl font-bold tracking-tight"
                style={{ color: theme.colors.primary }}
              >
                {businessName || 'Welcome'}
              </h1>
              <p className="text-xl opacity-80 max-w-lg">
                Experience quality and craftsmanship in every product we offer.
              </p>
              <ThemedButton
                asChild
                size="lg"
                colorRole="primary"
                className={cn(
                  'px-8 py-4 text-lg font-medium flex items-center gap-2 transition-all hover:gap-4',
                  radiusClass
                )}
              >
                <Link href={asRoute(getFullHref('/products'))}>
                  Explore Collection <ArrowRight className="size-5" />
                </Link>
              </ThemedButton>
            </div>
            <div
              className={cn(
                'relative h-[500px] overflow-hidden shadow-2xl',
                radiusClass
              )}
            >
              <Image
                src={heroImage}
                alt="Hero"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover transition-transform hover:scale-105 duration-700"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
