'use client';
import type { MerchantData } from "@/hooks/merchant/types";

import {
  Award,
  CheckCircle2,
  ChevronRight,
  Target,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type React from 'react';
import { useEffect } from 'react';
import { SafeHtml } from '@/components/ui/safe-html';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';

const values = [
  {
    title: 'Quality First',
    desc: 'Ask our team about the condition and inspection details of the device you are considering.',
    icon: Award,
    color: 'bg-blue-50 text-blue-600',
  },
  {
    title: 'Customer Obsession',
    desc: 'Your happiness is our KPI. From pre-sales to after-support, we are with you every step.',
    icon: Users,
    color: 'bg-red-50 text-red-600',
  },
  {
    title: 'Accessibility',
    desc: "Tech shouldn't break the bank. We offer competitive pricing and flexible swap options.",
    icon: Target,
    color: 'bg-green-50 text-green-600',
  },
];

interface AboutProps {
  merchant?: Partial<MerchantData>;
}

export const OgabasseyV2AboutUs: React.FC<AboutProps> = ({ merchant }) => {
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath ?? '';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const businessName = merchant?.business_name || 'Ogabassey';
  const aboutPage = merchant?.about_page || {};
  const legacyContent = merchant?.pages?.about;

  // Use content from merchant data or fallback to defaults
  const headline = aboutPage.headline || `Making Tech Accessible & Affordable`;
  const story = aboutPage.story || legacyContent || `Your premier destination for high-quality new and pre-owned gadgets. Bridging the digital divide, one device at a time.`;
  const location = merchant?.business_address || 'Lagos, Nigeria';

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Hero Section */}
      <div className="relative bg-[#1a1a1a] text-white py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 text-center">
          <span className="inline-block py-1 px-3 rounded-full bg-red-600/20 text-red-400 text-xs font-bold uppercase tracking-widest mb-6 border border-red-600/30">
            Our Story
          </span>
          <h1 className="text-4xl md:text-6xl font-extrabold mb-6 tracking-tight leading-tight">
            {headline}
          </h1>
          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            {story.substring(0, 150)}...
          </p>
        </div>
        {/* ... */}
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-16 md:py-24">
        {/* Mission & Vision */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 md:gap-20 items-center mb-24">
          <div className="order-2 lg:order-1">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl group aspect-video">
              <Image
                src={aboutPage.image_url || "/placeholder.png"}
                alt={aboutPage.image_url ? `${businessName} store` : "Store illustration"}
                fill sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-6 left-6 text-white">
                <p className="font-bold text-lg">Our Headquarters</p>
                <p className="text-sm opacity-80">{location}</p>
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
              Built on Trust, <br />
              Driven by Technology.
            </h2>
            <div className="space-y-6 text-gray-600 leading-relaxed">
              <SafeHtml html={story} />

              <ul className="space-y-3 pt-2">
                {[
                  'New and Pre-Owned Devices',
                  ...(merchant?.slug === 'ogabassey' ? ['1-Year Ogabassey Warranty', '14-Day Returns for Defective Items'] : []),
                  'Secure Payment & Wallet System',
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-3 font-medium text-gray-900"
                  >
                    <CheckCircle2
                      size={20}
                      className="text-green-500 shrink-0"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              {merchant?.slug === 'ogabassey' ? <><Link href={asRoute(`${basePath}/warranty`)} className="text-red-600 underline">Read warranty coverage and exclusions</Link>
              <Link href={asRoute(`${basePath}/returns`)} className="block text-red-600 underline">Read return eligibility and instructions</Link></> : null}
            </div>
          </div>
        </div>

        {/* Core Values */}
        {/* ... (Keep existing values) ... */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Why We Do What We Do
          </h2>
          <p className="text-gray-500">
            Our core values guide every decision we make, ensuring you get the
            best experience possible.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
          {values.map((val) => (
            <div
              key={val.title}
              className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
            >
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${val.color}`}
              >
                <val.icon size={28} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                {val.title}
              </h3>
              <p className="text-gray-600 leading-relaxed text-sm">
                {val.desc}
              </p>
            </div>
          ))}
        </div>

        {/* CTA Section */}
        {/* ... */}
        <div className="bg-red-600 rounded-3xl p-8 md:p-16 text-center text-white relative overflow-hidden shadow-2xl">
          <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              Ready to upgrade?
            </h2>
            <p className="text-red-100 text-lg mb-8 max-w-xl mx-auto">
              Explore new and pre-owned devices and find your next upgrade.
            </p>
            <Link
              href={asRoute(basePath)}
              className="inline-flex items-center gap-2 bg-white text-red-600 font-bold py-4 px-8 rounded-full hover:bg-gray-100 transition-colors shadow-lg active:scale-95"
            >
              Start Shopping <ChevronRight size={20} />
            </Link>
          </div>
          <div className="absolute top-0 left-0 size-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 size-96 bg-white/10 rounded-full translate-x-1/3 translate-y-1/3" />
        </div>
      </div>
    </div>
  );
};
