'use client';

import { Smartphone, Tv, Wallet, Wifi, Zap } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'airtime', icon: Smartphone, label: 'Airtime' },
  { id: 'data', icon: Wifi, label: 'Data' },
  { id: 'tv', icon: Tv, label: 'TV' },
  { id: 'power', icon: Zap, label: 'Power' },
  { id: 'betting', icon: Wallet, label: 'Betting' },
] as const;

export type UtilityTabId = (typeof TABS)[number]['id'];

interface UtilityTabsProps {
  activeTab: UtilityTabId;
  onSelect: (tab: UtilityTabId) => void;
  /** Blocks tab switches (click + keyboard) while a request is in flight. */
  disabled?: boolean;
}

export function UtilityTabs({
  activeTab,
  onSelect,
  disabled,
}: UtilityTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    // Native disabled blocks click/focus, but an already-focused tab
    // could still fire keydown — guard explicitly.
    if (disabled) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TABS.length - 1;
    }
    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    onSelect(TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      aria-label="Utility type"
      className="flex border-b border-gray-100 overflow-x-auto hide-scrollbar"
      role="tablist"
    >
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          aria-selected={activeTab === tab.id}
          disabled={disabled}
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          type="button"
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            'flex-1 flex flex-col items-center gap-1 py-3 px-4 min-w-[80px] transition-colors border-b-2',
            activeTab === tab.id
              ? 'border-store-primary text-store-primary bg-store-primary/5'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          )}
        >
          <tab.icon size={18} />
          <span className="text-xs font-medium">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
