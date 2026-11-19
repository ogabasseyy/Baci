'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fetchMerchantInboxInsights } from '@/lib/merchant-inbox-api';
import { cn } from '@/lib/utils';
import {
  MERCHANT_INBOX_INSIGHT_DAYS,
  type MerchantInboxInsightDays,
} from '@/schemas/merchant-inbox-insights-query';
import type { MerchantInboxInsights } from '@/schemas/merchant-inbox-insights-response';
import { formatInsightDuration } from './insights-format';
import { InsightsStat as Stat } from './insights-stat';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; insights: MerchantInboxInsights };

/** Chat totals and reply times for the Messages page. */
export function InsightsCard() {
  const [days, setDays] = useState<MerchantInboxInsightDays>(7);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchMerchantInboxInsights(days)
      .then((result) =>
        result.ok
          ? ({ status: 'ready', insights: result.insights } as const)
          : ({ status: 'error' } as const)
      )
      .catch(() => ({ status: 'error' }) as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Card className="p-4" aria-label="Chat insights">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Chat insights</h2>
        <div className="flex gap-1">
          {MERCHANT_INBOX_INSIGHT_DAYS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === days ? 'default' : 'outline'}
              aria-pressed={option === days}
              onClick={() => setDays(option)}
            >
              {option} days
            </Button>
          ))}
        </div>
      </div>
      {state.status === 'ready' ? (
        <dl
          className={cn(
            'mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6'
          )}
        >
          <Stat
            label="Conversations"
            value={String(state.insights.conversations)}
          />
          <Stat
            label="Customer messages"
            value={String(state.insights.customerMessages)}
          />
          <Stat
            label="Your replies"
            value={String(state.insights.storeReplies)}
          />
          <Stat label="Resolved" value={String(state.insights.resolved)} />
          <Stat
            label="First reply time"
            value={formatInsightDuration(
              state.insights.avgFirstResponseSeconds
            )}
          />
          <Stat
            label="Time to resolve"
            value={formatInsightDuration(state.insights.avgResolutionSeconds)}
          />
        </dl>
      ) : (
        <p
          role={state.status === 'loading' ? 'status' : 'alert'}
          className="mt-4 text-sm text-muted-foreground"
        >
          {state.status === 'loading'
            ? 'Loading insights…'
            : 'Insights are temporarily unavailable.'}
        </p>
      )}
    </Card>
  );
}
