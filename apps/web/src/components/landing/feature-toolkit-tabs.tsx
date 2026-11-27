'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { type KeyboardEvent, useRef, useState } from 'react';
import { FeatureIcon } from '@/components/landing/feature-icon';
import {
  PLATFORM_FEATURE_CATEGORIES,
  type PlatformFeatureCategory,
} from '@/config/platform-features';

interface FeatureToolkitTabsProps {
  categories?: readonly PlatformFeatureCategory[];
}

export function FeatureToolkitTabs({
  categories = PLATFORM_FEATURE_CATEGORIES,
}: FeatureToolkitTabsProps) {
  const [activeId, setActiveId] = useState<string>(categories[0]?.id ?? '');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeCategory =
    categories.find((cat) => cat.id === activeId) ?? categories[0];

  if (!activeCategory) {
    return null;
  }

  const totalCapabilities = categories.reduce(
    (sum, cat) => sum + cat.items.length,
    0
  );

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % categories.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + categories.length) % categories.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = categories.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextCategory = categories[nextIndex];
    if (nextCategory) {
      setActiveId(nextCategory.id);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className="mt-20 pt-16 border-t border-slate-200/80 dark:border-slate-800/80">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent mb-2">
            Everything Built-In ({totalCapabilities} Capabilities)
          </p>
          <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-primary dark:text-white">
            From discount codes to virtual terminals—no paid plugins required
          </h3>
        </div>
        <Link
          href="/features"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary dark:text-white hover:text-accent dark:hover:text-accent transition-colors shrink-0"
        >
          <span>Explore full feature directory</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Category Tablist */}
      <div
        role="tablist"
        aria-label="Baci built-in feature categories"
        className="flex flex-wrap gap-2 mb-8"
      >
        {categories.map((category, index) => {
          const isSelected = category.id === activeCategory.id;
          return (
            <button
              key={category.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`toolkit-tab-${category.id}`}
              aria-selected={isSelected}
              aria-controls={`toolkit-panel-${category.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveId(category.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                isSelected
                  ? 'bg-primary text-primary-foreground dark:bg-white dark:text-slate-950 border-primary dark:border-white shadow-sm'
                  : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-accent/60 hover:text-primary dark:hover:text-white'
              }`}
            >
              <span>{category.shortLabel}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isSelected
                    ? 'bg-white/20 text-current dark:bg-slate-900/15'
                    : 'bg-slate-100 dark:bg-slate-900 text-muted-foreground'
                }`}
              >
                {category.items.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Category Panel */}
      <div
        role="tabpanel"
        id={`toolkit-panel-${activeCategory.id}`}
        aria-labelledby={`toolkit-tab-${activeCategory.id}`}
        className="rounded-3xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm"
      >
        <p className="text-base text-muted-foreground mb-6">
          {activeCategory.tagline}
        </p>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {activeCategory.items.map((item) => (
            <li key={item.id}>
              <article className="h-full flex flex-col justify-between p-5 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/80 hover:border-accent/40 transition-colors">
                <div>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="size-9 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                      <FeatureIcon
                        name={item.icon}
                        className="size-4 text-accent"
                      />
                    </div>
                    <h4 className="text-base font-semibold text-primary dark:text-white leading-snug">
                      {item.title}
                    </h4>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <ul
                  aria-label="Available on"
                  className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/60"
                >
                  {item.surfaces.map((surface) => (
                    <li
                      key={surface}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-800"
                    >
                      {surface}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
