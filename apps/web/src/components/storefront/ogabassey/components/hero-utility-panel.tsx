'use client';

import {
  Gamepad2,
  Phone,
  Tv,
  Wifi,
  Zap,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS } from './hero-mobile-geometry';

export type UtilityTab = 'airtime' | 'data' | 'tv' | 'power' | 'betting';

interface UtilityOption {
  id: UtilityTab;
  label: string;
  mobileLabel?: string;
  Icon: typeof Phone;
}

const UTILITY_OPTIONS: UtilityOption[] = [
  { id: 'airtime', label: 'Airtime', Icon: Phone },
  { id: 'data', label: 'Data', Icon: Wifi },
  { id: 'tv', label: 'Tv', Icon: Tv },
  { id: 'power', label: 'Power', Icon: Zap },
  { id: 'betting', label: 'Gaming', Icon: Gamepad2, mobileLabel: 'Gaming' },
];

const UTILITY_WORDS = ['Airtime!', 'Data!', 'TV!', 'Power!', 'Gaming!'];

const DeferredUtilityModal = dynamic(
  () => import('./UtilityModal').then((mod) => mod.UtilityModal),
  { ssr: false, loading: () => null }
);

interface UtilityOptionButtonProps {
  isActive: boolean;
  option: UtilityOption;
  onSelect: (option: UtilityOption, index: number) => void;
  index: number;
  tone: 'mobile' | 'desktop';
}

function UtilityOptionButton({
  isActive,
  option,
  onSelect,
  index,
  tone,
}: UtilityOptionButtonProps) {
  const baseClass =
    tone === 'mobile'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-gray-50 text-gray-600 group-hover:bg-primary group-hover:text-primary-foreground';
  const activeClass =
    option.id === 'betting' && tone === 'mobile'
      ? 'bg-primary/10 text-primary'
      : 'bg-primary/10 text-primary';
  const Icon = option.Icon;

  return (
    <button
      type="button"
      data-utility-option={option.id}
      onClick={() => onSelect(option, index)}
      className="flex flex-col items-center gap-2 group cursor-pointer"
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-[background-color,color] duration-300 ${isActive ? activeClass : baseClass}`}
      >
        <Icon size={20} />
      </div>
      <span
        className={`text-xs font-medium transition-colors duration-300 ${isActive ? 'text-gray-900 font-bold' : 'text-gray-700'}`}
      >
        {option.mobileLabel || option.label}
      </span>
    </button>
  );
}

export interface HeroUtilityPanelProps {
  /**
   * Utility the shopper tapped while the static fallback was still mounted.
   * The gate replays it on mount (opens that tab's modal) so the first tap
   * is honored instead of merely triggering the module load. Null/omitted
   * for viewport- and timeout-driven activations.
   */
  pendingUtilityTab?: UtilityTab | null;
}

export function HeroUtilityPanel({
  pendingUtilityTab = null,
}: HeroUtilityPanelProps = {}) {
  const pendingIndex = pendingUtilityTab
    ? UTILITY_OPTIONS.findIndex((option) => option.id === pendingUtilityTab)
    : -1;
  const hasPendingUtility = pendingIndex >= 0;
  const [activeUtilityIndex, setActiveUtilityIndex] = useState(
    hasPendingUtility ? pendingIndex : 0
  );
  const [manualUtility, setManualUtility] = useState(hasPendingUtility);
  const [showUtilityModal, setShowUtilityModal] = useState(hasPendingUtility);
  const [utilityTab, setUtilityTab] = useState<UtilityTab>(
    hasPendingUtility && pendingUtilityTab ? pendingUtilityTab : 'airtime'
  );

  useEffect(() => {
    if (manualUtility) return;
    // matchMedia is universal in browsers but absent in some test/SSR
    // shells; a missing API must not crash the panel (it only gates a
    // decorative rotation). Null means "no preference expressed".
    const motion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer || motion?.matches) return;
      timer = setInterval(() => {
        if (!document.hidden && !motion?.matches) {
          setActiveUtilityIndex((index) => (index + 1) % UTILITY_WORDS.length);
        }
      }, 2500);
    };
    // Keep pre-interaction LCP stable; resume decorative rotation on engagement.
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const event of events) window.addEventListener(event, start, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, start);
      if (timer) clearInterval(timer);
    };
  }, [manualUtility]);

  const handleUtilitySelect = (option: UtilityOption, index: number) => {
    setManualUtility(true);
    setUtilityTab(option.id);
    setShowUtilityModal(true);
    setActiveUtilityIndex(index);
  };

  return (
    <div className="w-full bg-white mt-3 md:mt-8 mb-6 border-y border-gray-100 md:py-5" data-ogabassey-hero-utility="true">
      <div className="md:hidden px-4">
        <div
          className={`${HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS} bg-white rounded-3xl shadow-sm border border-gray-100 p-2`}
          data-ogabassey-mobile-utility-panel="true"
        >
          <div className="bg-primary/5 rounded-2xl py-3 px-4 mb-4 text-center">
            <span className="text-gray-900 font-medium text-sm">
              We Pay <span className="text-primary font-bold">YOU</span> When You Buy{' '}
              {/*
                All words stay in the tree, stacked in one grid cell, so the
                box always sizes to the longest word ("Airtime!"). Swapping the
                visible word then repaints without resizing — the previous
                single-word span grew/shrank past its 60px floor on every
                rotation, shifting the surrounding copy (field CLS).
              */}
              <span className="text-primary font-bold transition-all duration-500 inline-grid min-w-[60px] text-left align-baseline">
                {UTILITY_WORDS.map((word, index) => (
                  <span
                    aria-hidden={index === activeUtilityIndex ? undefined : true}
                    className={`col-start-1 row-start-1 ${index === activeUtilityIndex ? '' : 'invisible'}`}
                    key={word}
                  >
                    {word}
                  </span>
                ))}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2 px-1 pb-2">
            {UTILITY_OPTIONS.map((option, index) => (
              <UtilityOptionButton
                key={option.id}
                isActive={activeUtilityIndex === index}
                option={option}
                onSelect={handleUtilitySelect}
                index={index}
                tone="mobile"
              />
            ))}
          </div>
        </div>
      </div>

      <div className="hidden md:flex max-w-[1400px] mx-auto px-4 md:px-6 flex-row items-center justify-between">
        <div className="bg-primary/5 px-10 py-8 rounded-lg min-w-[280px] text-center xl:text-left xl:translate-x-[-5%]">
          <span className="text-gray-900 font-medium text-xl">
            We Pay <span className="text-primary font-bold">YOU</span> When
          </span>
        </div>

        <div className="flex justify-center gap-8 md:gap-12 flex-wrap">
          {UTILITY_OPTIONS.map((option, index) => (
            <UtilityOptionButton
              key={option.id}
              isActive={activeUtilityIndex === index}
              option={option}
              onSelect={handleUtilitySelect}
              index={index}
              tone="desktop"
            />
          ))}
        </div>

        <div className="hidden md:block bg-primary/5 px-10 py-8 rounded-lg min-w-[280px] text-center xl:text-right xl:translate-x-[5%]">
          <span className="text-gray-900 font-medium text-xl">
            You Buy{' '}
            {/*
              Same stacked-words reservation as mobile: the desktop floor was
              80px but "Airtime!" at text-xl renders wider, so every rotation
              through it resized the box. Stacked grid cells size to the
              longest word once; rotation is paint-only.
            */}
            <span className="text-primary font-bold transition-all duration-500 inline-grid min-w-[80px] text-left align-baseline">
              {UTILITY_WORDS.map((word, index) => (
                <span
                  aria-hidden={index === activeUtilityIndex ? undefined : true}
                  className={`col-start-1 row-start-1 ${index === activeUtilityIndex ? '' : 'invisible'}`}
                  key={word}
                >
                  {word}
                </span>
              ))}
            </span>
          </span>
        </div>
      </div>

      {showUtilityModal && (
        <DeferredUtilityModal
          isOpen={showUtilityModal}
          onClose={() => setShowUtilityModal(false)}
          initialTab={utilityTab}
        />
      )}
    </div>
  );
}
