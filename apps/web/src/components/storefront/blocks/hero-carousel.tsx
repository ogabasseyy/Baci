'use client';

import Autoplay from 'embla-carousel-autoplay';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useStorefrontScopedRoute } from '@/components/builder/use-storefront-scoped-route';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';

export interface HeroCarouselProps {
  slides: {
    image: string;
    title: string;
    subtitle: string;
    ctaText: string;
    ctaLink: string;
  }[];
  autoplayDelay?: number;
  height?: 'small' | 'medium' | 'large' | 'fullscreen';
}

export function HeroCarousel({
  slides,
  autoplayDelay = 5000,
  height = 'fullscreen',
}: HeroCarouselProps) {
  const toStorefrontRoute = useStorefrontScopedRoute();
  // Lazy state initializer keeps a stable plugin instance without reading a
  // ref during render (refs cannot be accessed while rendering).
  const [plugin] = useState(() =>
    Autoplay({ delay: autoplayDelay, stopOnInteraction: true })
  );

  const heightClasses = {
    small: 'h-[40vh]',
    medium: 'h-[60vh]',
    large: 'h-[80vh]',
    fullscreen: 'h-[85vh]', // Slightly less than 100vh to show content below
  };

  return (
    <section
      className={`relative w-full overflow-hidden ${heightClasses[height]}`}
    >
      <Carousel
        className="w-full h-full [&>div]:h-full"
        plugins={[plugin]}
        opts={{ loop: true, duration: 60 }}
      >
        <CarouselContent className="h-full">
          {slides.map((slide, index) => (
            <CarouselItem
              key={slide.title}
              className="h-full relative overflow-hidden"
            >
              {/* Parallax Background - Elite 2025 Standard */}
              <div className="absolute inset-0 w-[110%] -translate-x-[5%]">
                <Image
                  src={slide.image}
                  alt={slide.title}
                  fill
                  className="object-cover"
                  priority={index === 0}
                  sizes="(max-width: 768px) 100vw, 100vw"
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
              </div>

              {/* Elite Content Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 text-center text-white px-4 z-10">
                <div className="max-w-4xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-10 motion-safe:zoom-in-95 motion-safe:duration-500">
                  <h1 className="text-5xl md:text-8xl font-black tracking-tighter mb-6 drop-shadow-2xl">
                    {slide.title}
                  </h1>
                  <p className="text-xl md:text-3xl text-white/80 max-w-2xl mx-auto mb-10 font-medium leading-tight">
                    {slide.subtitle}
                  </p>
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full h-16 px-12 text-xl bg-white text-black hover:bg-white/90 hover:scale-105 transition-all duration-300 shadow-[0_0_40px_rgba(255,255,255,0.3)] border-none"
                  >
                    <Link href={toStorefrontRoute(slide.ctaLink)}>
                      {slide.ctaText}
                    </Link>
                  </Button>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="absolute left-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex bg-white/10 hover:bg-white/20 border-white/20 text-white" />
        <CarouselNext className="absolute right-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex bg-white/10 hover:bg-white/20 border-white/20 text-white" />
      </Carousel>
    </section>
  );
}
