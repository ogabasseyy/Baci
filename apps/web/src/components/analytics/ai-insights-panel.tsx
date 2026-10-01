'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import type { AnalyticsCategory } from './analytics-category-nav';

interface Insight {
  title: string;
  description: string;
  type: 'positive' | 'negative' | 'neutral' | 'opportunity';
  priority: 'high' | 'medium' | 'low';
  action?: string;
  category?: AnalyticsCategory;
}

interface AIInsightsPanelProps {
  className?: string;
  activeCategory: AnalyticsCategory;
  merchantId?: string;
}

// Default placeholder insights shown while AI loads
const placeholderInsights: Insight[] = [
  {
    title: 'Analyzing your data...',
    description:
      'AI is reviewing your sales patterns, customer behavior, and inventory trends.',
    type: 'neutral',
    priority: 'medium',
  },
];

// Category keywords for filtering insights - defined outside component to avoid recreation
const CATEGORY_KEYWORDS: Partial<Record<AnalyticsCategory, readonly string[]>> =
  {
    finance: ['revenue', 'sales', 'profit', 'cost', 'money'],
    products: ['product', 'stock', 'inventory', 'selling'],
    customers: ['customer', 'user', 'buyer', 'retention'],
    marketing: ['campaign', 'ad', 'social', 'traffic', 'conversion'],
    inventory: ['inventory', 'stock', 'warehouse', 'supply'],
    segments: ['segment', 'cohort', 'group', 'audience'],
    ads: ['ad', 'campaign', 'advertising', 'promotion'],
  } as const;

interface FetchInsightsCallbacks {
  merchantId?: string;
  signal: AbortSignal;
  setInsights: (insights: Insight[]) => void;
  setError: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  startTransition: (callback: () => void) => void;
}

async function fetchInsights({
  merchantId,
  signal,
  setInsights,
  setError,
  setLoading,
  startTransition,
}: FetchInsightsCallbacks) {
  try {
    const response = await fetch('/api/analytics/insights', {
      headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
      signal,
      // Don't block on this request
      priority: 'low' as RequestPriority,
    });

    if (!response.ok) {
      // Log but don't throw - we have a graceful fallback UI
      console.warn(`AI insights unavailable (${response.status})`);
      setError(true);
      return;
    }

    const data = await response.json();

    // Use transition to avoid blocking UI
    startTransition(() => {
      setInsights(data.insights || []);
      setError(false);
    });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      // Only warn - insights are non-critical
      console.warn('AI insights fetch failed:', (err as Error).message);
      setError(true);
    }
  } finally {
    setLoading(false);
  }
}

export function AIInsightsPanel({
  className,
  activeCategory,
  merchantId,
}: AIInsightsPanelProps) {
  const [insights, setInsights] = useState<Insight[]>(placeholderInsights);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    let isCurrentRequest = true;
    setInsights(placeholderInsights);
    setLoading(true);
    setError(false);
    setCurrentIndex(0);

    fetchInsights({
      merchantId,
      signal: controller.signal,
      setInsights: (value) => {
        if (isCurrentRequest) setInsights(value);
      },
      setError: (value) => {
        if (isCurrentRequest) setError(value);
      },
      setLoading: (value) => {
        if (isCurrentRequest) setLoading(value);
      },
      startTransition: (callback) => {
        startTransition(() => {
          if (isCurrentRequest) callback();
        });
      },
    });

    return () => {
      isCurrentRequest = false;
      controller.abort();
    };
  }, [merchantId]);

  // Filter insights based on active category
  const filteredInsights =
    activeCategory === 'overview'
      ? insights
      : insights.filter((insight) => {
          const text = (insight.title + insight.description).toLowerCase();
          return (
            CATEGORY_KEYWORDS[activeCategory]?.some((k) => text.includes(k)) ??
            true
          );
        });

  // Auto-rotate insights every 5 seconds
  useEffect(() => {
    if (filteredInsights.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % filteredInsights.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [filteredInsights.length]);

  const currentInsight = filteredInsights[currentIndex];
  const isAnalyzing = loading || isPending;

  // Always render - show placeholder/skeleton state while loading
  return (
    <div
      className={cn(
        'w-full min-h-[72px] h-auto rounded-xl border bg-card/50 backdrop-blur-xs flex items-center px-4 py-3 gap-3 relative overflow-hidden shadow-sm transition-all',
        isAnalyzing && 'bg-linear-to-r from-indigo-500/5 to-violet-500/5',
        error && 'border-destructive/30',
        className
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
          isAnalyzing ? 'bg-indigo-500/10' : 'bg-primary/10'
        )}
      >
        {isAnalyzing ? (
          <RefreshCw className="size-5 text-indigo-500 animate-spin" />
        ) : (
          <Sparkles className="size-5 text-primary" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 relative flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h2 className="text-sm font-semibold text-foreground">
                Insights unavailable
              </h2>
              <p className="text-xs text-muted-foreground">
                We couldn't load AI insights right now. Your analytics data is
                still available below.
              </p>
            </motion.div>
          ) : currentInsight ? (
            <motion.div
              key={`insight-${currentIndex}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3 }}
            >
              <h2
                className={cn(
                  'text-sm font-semibold text-foreground',
                  isAnalyzing && 'text-indigo-600 dark:text-indigo-400'
                )}
              >
                {currentInsight.title}
              </h2>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {currentInsight.description}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="no-insights"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <h2 className="text-sm font-semibold text-foreground">
                No insights yet
              </h2>
              <p className="text-xs text-muted-foreground">
                Keep selling to generate AI-powered insights about your
                business.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Indicator dots - only show when we have multiple real insights */}
      {!isAnalyzing && !error && filteredInsights.length > 1 && (
        <div className="flex gap-1">
          {filteredInsights.map((_, idx) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: Pagination indicators have stable positions
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              aria-label={`View insight ${idx + 1}`}
              className={cn(
                'h-1.5 rounded-full transition-all hover:bg-primary/50',
                idx === currentIndex
                  ? 'bg-primary w-4'
                  : 'bg-muted-foreground/30 w-1.5'
              )}
            />
          ))}
        </div>
      )}

      {/* Loading shimmer overlay */}
      {isAnalyzing && (
        <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent animate-shimmer pointer-events-none" />
      )}
    </div>
  );
}
