'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import type { OnboardingReminder } from '@/lib/onboarding-reminders/policy';
import { onboardingReminderResponseSchema } from '@/schemas/onboarding-reminder';

/** One live reminder across the dashboard; no queued copies or toast interruptions. */
export function OnboardingReminderBanner({
  merchantId,
}: {
  merchantId: string;
}) {
  const pathname = usePathname();
  const [state, setState] = useState<{
    merchantId: string;
    pathname: string | null;
    reminder: OnboardingReminder | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const snoozing = useRef(false);
  const endpoint = `/api/merchant/onboarding-reminder?merchantId=${encodeURIComponent(merchantId)}`;

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      if (document.visibilityState === 'hidden' || snoozing.current) return;
      controller?.abort();
      controller = new AbortController();
      const requestGeneration = ++generation.current;
      const isCurrent = () =>
        active && requestGeneration === generation.current;
      setSaving(false);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          if (isCurrent()) setState(null);
          return;
        }
        const parsed = onboardingReminderResponseSchema.safeParse(
          await response.json()
        );
        if (isCurrent()) {
          setState(
            parsed.success && parsed.data.merchantId === merchantId
              ? { merchantId, pathname, reminder: parsed.data.reminder }
              : null
          );
        }
      } catch {
        // Optional reminders fail closed; dashboard and setup checklist remain usable.
        if (isCurrent()) setState(null);
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      ++generation.current;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [endpoint, merchantId, pathname]);

  const reminder =
    state?.merchantId === merchantId && state.pathname === pathname
      ? state.reminder
      : null;
  if (!reminder) return null;

  const snooze = async () => {
    if (snoozing.current) return;
    snoozing.current = true;
    const requestGeneration = ++generation.current;
    setSaving(true);
    setError(null);
    try {
      const response = await fetchWithCsrf(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'snooze' }),
      });
      if (!response.ok) throw new Error('Snooze failed');
      if (requestGeneration === generation.current) setState(null);
    } catch {
      if (requestGeneration === generation.current) {
        setError('Could not snooze this reminder. Please try again.');
      }
    } finally {
      snoozing.current = false;
      if (requestGeneration === generation.current) setSaving(false);
    }
  };

  return (
    <aside
      aria-label="Store setup reminder"
      className="mb-4 rounded-lg border bg-muted/40 p-4"
    >
      <p className="font-semibold">{reminder.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {reminder.description}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href={reminder.href as Route}>{reminder.action}</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={snooze} disabled={saving}>
          Remind me tomorrow
        </Button>
        <Link
          className="text-sm underline"
          href="/dashboard/notifications/preferences"
        >
          Notification settings
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </aside>
  );
}
