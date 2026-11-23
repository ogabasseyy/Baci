'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type ChatAlertLevel,
  chatAlertLevelSchema,
  chatNotificationSettingsSchema,
} from '@/schemas/chat-notification-settings';

const ENDPOINT = '/api/merchant/chat-notifications';

const OPTIONS: ReadonlyArray<{
  value: ChatAlertLevel;
  label: string;
  hint: string;
}> = [
  {
    value: 'all',
    label: 'All new messages',
    hint: 'Hear about every customer message, and when the assistant hands a chat to you.',
  },
  {
    value: 'handover',
    label: 'Only when the assistant hands a chat to a person',
    hint: 'No alert for ordinary messages. You are told when a customer needs you.',
  },
  {
    value: 'off',
    label: 'Off',
    hint: 'No alerts about customer chats. You can still read them in Messages.',
  },
];

type Load =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'error' }
  | { state: 'ready'; level: ChatAlertLevel };

// Signed out, not allowed to view it, or chat is not on for this store: the
// control is simply not for this person. Anything else is a failed load.
const NOT_AVAILABLE_STATUSES = new Set([401, 403, 404]);

async function loadLevel(merchantId: string | undefined): Promise<Load> {
  try {
    const response = await fetch(ENDPOINT, {
      headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
    });
    if (NOT_AVAILABLE_STATUSES.has(response.status)) {
      return { state: 'unavailable' };
    }
    if (!response.ok) return { state: 'error' };
    const parsed = chatNotificationSettingsSchema.safeParse(
      await response.json()
    );
    return parsed.success
      ? { state: 'ready', level: parsed.data.level }
      : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

/**
 * Choice of which customer-chat events alert the merchant, in the
 * notifications bell and as a push to the merchant app. It loads its own
 * state and renders nothing when chat is not available for this store, so
 * other merchants never see it. A failed load shows a retry instead of
 * removing the control, and switching stores keeps the current choice on
 * screen, locked, until the other store's answer arrives.
 */
export function ChatMessageAlertSetting() {
  const { toast } = useToast();
  // The store the dashboard has selected; the API falls back to the account's
  // latest store only when there is no merchant context.
  const merchantId = useMerchantSafe()?.merchant?.id;
  const contextHeaders = merchantId
    ? { 'x-baci-merchant-id': merchantId }
    : undefined;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [fetching, setFetching] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  // `attempt` is not read inside: bumping it is how "Try again" reloads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let stale = false;
    setFetching(true);
    loadLevel(merchantId).then((next) => {
      if (stale) return;
      setLoad(next);
      setFetching(false);
    });
    return () => {
      stale = true;
    };
  }, [merchantId, attempt]);

  if (load.state === 'loading' || load.state === 'unavailable') return null;

  if (load.state === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Customer Chat Alerts</p>
        <p className="text-sm text-muted-foreground">
          We could not load this setting.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fetching}
          onClick={() => setAttempt((count) => count + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }

  const level = load.level;

  const change = async (next: string) => {
    const chosen = chatAlertLevelSchema.safeParse(next);
    if (!chosen.success || chosen.data === level) return;
    const previous = level;
    setLoad({ state: 'ready', level: chosen.data });
    setSaving(true);
    try {
      const response = await fetchWithCsrf(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...contextHeaders },
        body: JSON.stringify({ level: chosen.data }),
      });
      const parsed = chatNotificationSettingsSchema.safeParse(
        response.ok ? await response.json() : null
      );
      if (!parsed.success) throw new Error('save failed');
      setLoad({ state: 'ready', level: parsed.data.level });
    } catch {
      setLoad({ state: 'ready', level: previous });
      toast({
        title: 'Could not save',
        description: 'Your chat alert setting was not changed. Try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p id="chat_message_alerts_label" className="text-sm font-medium">
          Customer Chat Alerts
        </p>
        <p className="text-sm text-muted-foreground">
          Choose when to be alerted about customer chats, in your notifications
          and on your merchant app
        </p>
      </div>
      <RadioGroup
        value={level}
        onValueChange={change}
        disabled={saving || fetching}
        aria-labelledby="chat_message_alerts_label"
      >
        {OPTIONS.map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              id={`chat_message_alerts_${option.value}`}
              value={option.value}
              className="mt-1"
            />
            <div className="space-y-0.5">
              <Label htmlFor={`chat_message_alerts_${option.value}`}>
                {option.label}
              </Label>
              <p className="text-sm text-muted-foreground">{option.hint}</p>
            </div>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
