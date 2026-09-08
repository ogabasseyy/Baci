// Template preview
'use client';

import type { RepairDeviceBrandGroup } from '@baci/shared/repairs';
import {
  Battery,
  ChevronRight,
  HeartPulse,
  Laptop,
  Leaf,
  Monitor,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { RepairDevicePicker } from '@/components/storefront/repairs/RepairDevicePicker';
import { asRoute } from '@/lib/routes';
import { RepairsLabHero } from './repairs-lab-hero';
import { RepairsRecyclingSection } from './repairs-recycling-section';

interface OgabasseyV2RepairsProps {
  basePath?: string;
  storeSlug?: string;
  /**
   * Catalogue device groups. `undefined` means the repairs catalogue flag is
   * off for this merchant — keep today's static services grid so nothing
   * breaks before the flag is enabled. An array (including an empty one)
   * means the flag is on — render the real, catalogue-driven device picker.
   */
  groups?: RepairDeviceBrandGroup[];
}

export function OgabasseyV2Repairs({
  basePath,
  groups,
  storeSlug,
}: OgabasseyV2RepairsProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const services = [
    {
      title: 'Screen Renewal',
      price: 'From ₦25,000',
      icon: Monitor,
      desc: "Don't let a crack end its life.",
    },
    {
      title: 'Battery Boost',
      price: 'From ₦15,000',
      icon: Battery,
      desc: 'Restore all-day power.',
    },
    {
      title: 'Port Restoration',
      price: 'From ₦12,000',
      icon: Smartphone,
      desc: 'Fix charging connection issues.',
    },
    {
      title: 'System Revive',
      price: 'From ₦10,000',
      icon: Laptop,
      desc: 'Software fixes & optimization.',
    },
  ];

  const normalizedBasePath =
    basePath !== undefined
      ? basePath.replace(/\/+$/, '')
      : storeSlug
        ? `/${storeSlug}`
        : '/ogabassey';
  const repairLink = asRoute(`${normalizedBasePath}/repair`);
  const swapLink = asRoute(`${normalizedBasePath}/swap`);

  return (
    <div className="min-h-screen bg-store-secondary pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col text-store-background-text">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        <RepairsLabHero repairHref={repairLink} swapHref={swapLink} />

        {/* The Repair Impact */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="bg-store-background p-6 rounded-2xl border border-store-border shadow-sm text-center group hover:-translate-y-1 transition-transform">
            <div className="size-14 bg-store-primary/5 text-store-primary rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <HeartPulse size={28} />
            </div>
            <h3 className="font-bold text-store-background-text mb-2">
              Extend Lifespan
            </h3>
            <p className="text-sm text-store-background-text/55">
              Repairing adds 2-3 years to your device's life, saving you the
              cost of a new phone.
            </p>
          </div>
          <div className="bg-store-background p-6 rounded-2xl border border-store-border shadow-sm text-center group hover:-translate-y-1 transition-transform">
            <div className="size-14 bg-store-secondary text-store-secondary-text rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Leaf size={28} />
            </div>
            <h3 className="font-bold text-store-background-text mb-2">
              Reduce E-Waste
            </h3>
            <p className="text-sm text-store-background-text/55">
              Electronic waste is toxic. Repairing keeps hazardous materials out
              of the soil.
            </p>
          </div>
          <div className="bg-store-background p-6 rounded-2xl border border-store-border shadow-sm text-center group hover:-translate-y-1 transition-transform">
            <div className="size-14 bg-store-accent/10 text-store-accent rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <ShieldCheck size={28} />
            </div>
            <h3 className="font-bold text-store-background-text mb-2">
              Data Safety
            </h3>
            <p className="text-sm text-store-background-text/55">
              Keep your photos and files. Transferring data to a new device is
              risky; keeping yours is safe.
            </p>
          </div>
        </div>

        {/* Services / device picker */}
        <h3 className="font-bold text-xl text-store-background-text mb-6 flex items-center gap-2">
          <Wrench className="text-store-primary" size={20} />{' '}
          {groups ? 'Select Your Device' : 'Restoration Services'}
        </h3>
        {groups ? (
          <div className="mb-16">
            <RepairDevicePicker
              basePath={normalizedBasePath}
              groups={groups}
              notListedHref={repairLink}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
            {services.map((service) => (
              <div
                key={service.title}
                className="bg-store-background p-5 rounded-2xl border border-store-border hover:border-store-primary/40 hover:shadow-md transition-all group cursor-pointer relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity text-store-primary">
                  <Zap size={40} className="opacity-10" />
                </div>
                <div className="size-12 bg-store-secondary rounded-xl flex items-center justify-center mb-4 group-hover:bg-store-primary/5 group-hover:text-store-primary transition-colors">
                  <service.icon size={24} />
                </div>
                <h4 className="font-bold text-store-background-text mb-1">
                  {service.title}
                </h4>
                <p className="text-xs text-store-background-text/55 mb-4 h-8">
                  {service.desc}
                </p>
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-store-border/50">
                  <span className="text-sm font-bold text-store-primary">
                    {service.price}
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-store-background-text/30 group-hover:text-store-primary"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Maintenance Banner */}
        <div className="bg-store-background border border-store-border rounded-2xl p-8 md:p-10 relative overflow-hidden mb-16 shadow-sm">
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
            <div className="size-20 bg-store-primary/5 rounded-full flex items-center justify-center text-store-primary shrink-0 border border-store-primary/10">
              <Sparkles size={40} />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-2xl font-bold mb-2 text-store-background-text">
                Preventative Care is Free
              </h3>
              <p className="text-store-background-text/65 text-sm md:text-base max-w-2xl leading-relaxed">
                Often, a "broken" charging port is just dirty. Visit us for a{' '}
                <strong>free cleaning service</strong>. We'll clear out dust and
                lint from your speakers and ports to restore performance
                instantly.
              </p>
            </div>
            <div className="shrink-0">
              <Link
                href={asRoute(normalizedBasePath || '/')}
                className="bg-store-background-text text-store-background font-bold py-3 px-6 rounded-xl hover:opacity-90 transition-opacity shadow-lg active:scale-95"
              >
                Visit Store
              </Link>
            </div>
          </div>
        </div>

        {/* Recycling Section - Neutral Tones */}
        <RepairsRecyclingSection />
      </div>
    </div>
  );
}
