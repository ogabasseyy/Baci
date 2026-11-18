// Template preview
'use client';

import {
  ArrowRight,
  Camera,
  Check,
  DollarSign,
  Leaf,
  Recycle,
  RefreshCw,
  Video,
} from 'lucide-react';
import { useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { SparklesIcon } from './swap-sparkles-icon';
import { TradeInModal } from './swap-trade-in-modal';

export function OgabasseyV2Swap() {
  const merchantContext = useMerchantSafe();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Clean phone number for links
  const supportPhone = merchantContext?.merchant?.support_phone?.replace(/\D/g, '') || '2348146978921';

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      {/* Mounted only while open so each visit starts at a fresh upload step. */}
      {isModalOpen && (
        <TradeInModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          supportPhone={supportPhone}
          merchantSlug={merchantContext?.merchant?.slug}
        />
      )}

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <RefreshCw className="text-red-600" />
          Swap & Trade-in
        </h1>
        <p className="text-gray-500 text-sm mb-8 max-w-xl">
          Upgrade to the latest tech for less. Trade in your old device and use
          the value towards a new purchase.
        </p>

        {/* Hero Section */}
        <div className="bg-linear-to-r from-red-600 to-red-800 text-white rounded-2xl p-8 md:p-12 mb-10 relative overflow-hidden shadow-xl">
          <div className="relative z-10 max-w-lg">
            <span className="inline-block bg-white/20 backdrop-blur-md text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wider">
              Instant AI check ✨
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4 leading-tight">
              Get an Instant AI Valuation in Seconds.
            </h2>
            <p className="text-white/80 mb-8 text-sm md:text-base">
              Simply upload a few photos or a short video of your device. Our AI will analyze the condition and give you an instant trade-in offer.
            </p>
            <button type="button"
              onClick={() => setIsModalOpen(true)}
              className="bg-white text-red-700 font-bold py-3.5 px-8 rounded-xl hover:bg-gray-100 transition-colors shadow-lg active:scale-95 flex items-center gap-2"
            >
              Start AI Trade-in <Camera size={18} />
            </button>
          </div>

          {/* Background Decorations */}
          <div className="absolute right-0 bottom-0 size-64 bg-white/10 rounded-full blur-3xl transform translate-y-1/2 translate-x-1/2" />
          <RefreshCw className="absolute -right-12 top-1/2 -translate-y-1/2 text-white/10 size-80 rotate-12" />
        </div>

        {/* How it Works */}
        <div className="mb-10">
          <h3 className="font-bold text-lg text-gray-900 mb-6 text-center">
            How it Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: '1. Take Photos or a Video',
                desc: 'Snap a few photos or a quick 10s video showing your device screen and body.',
                icon: Video,
              },
              {
                title: '2. AI Analysis',
                desc: 'Our AI grades your device condition automatically.',
                icon: SparklesIcon,
              },
              {
                title: '3. Get Paid',
                desc: 'Accept the offer and swap instantly.',
                icon: DollarSign,
              },
            ].map((step, idx) => (
              <div
                key={step.title}
                className="bg-white p-6 rounded-2xl border border-gray-100 text-center shadow-sm relative"
              >
                <div className="size-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                  <step.icon size={24} />
                </div>
                <h4 className="font-bold text-gray-900 mb-2">{step.title}</h4>
                <p className="text-sm text-gray-500">{step.desc}</p>

                {idx < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10 bg-white p-1 rounded-full border border-gray-200 text-gray-400">
                    <ArrowRight size={14} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Eligible Devices */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 mb-10">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-lg text-gray-900">
              What can you trade in?
            </h3>
          </div>
          <div className="space-y-3">
            {[
              'iPhones (11 and newer)',
              'Samsung Galaxy S Series',
              'MacBooks (2018+)',
              'PlayStation 4 & 5',
              'iPads',
            ].map((item, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: Static list
                key={i}
                className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors border-b border-gray-50 last:border-0"
              >
                <div className="size-6 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0">
                  <Check size={14} strokeWidth={3} />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sustainability Impact */}
        <div className="bg-green-50 rounded-2xl p-6 md:p-8 border border-green-100 flex flex-col md:flex-row items-center gap-6 text-center md:text-left shadow-sm">
          <div className="size-16 bg-white text-green-600 rounded-full flex items-center justify-center shadow-sm shrink-0 border border-green-100">
            <Leaf size={32} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <Recycle size={20} className="text-green-600" />
              <h3 className="font-bold text-green-900 text-lg">
                Trade-in is Recycling
              </h3>
            </div>
            <p className="text-green-800 text-sm leading-relaxed max-w-2xl">
              By swapping your device, you keep e-waste out of landfills. We
              refurbish and re-home your old gadgets, extending their lifecycle
              and reducing the carbon footprint of manufacturing new ones.{' '}
              <span className="font-bold">
                It's a win for your wallet and the planet.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
