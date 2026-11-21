'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

/**
 * Choice of which customer-chat events alert the merchant, in the
 * notifications bell and as a push to the merchant app. It loads its own
 * state and renders nothing unless the server says chat is available for this
 * store, so other merchants never see it.
 */
export function ChatMessageAlertSetting() {
  const { toast } = useToast();
  const [level, setLevel] = useState<ChatAlertLevel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stale = false;
    fetch(ENDPOINT)
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = chatNotificationSettingsSchema.safeParse(
          await response.json()
        );
        return parsed.success ? parsed.data.level : null;
      })
      .then((value) => {
        if (!stale) setLevel(value);
      })
      .catch(() => {
        if (!stale) setLevel(null);
      });
    return () => {
      stale = true;
    };
  }, []);

  if (level === null) return null;

  const change = async (next: string) => {
    const chosen = chatAlertLevelSchema.safeParse(next);
    if (!chosen.success || chosen.data === level) return;
    const previous = level;
    setLevel(chosen.data);
    setSaving(true);
    try {
      const response = await fetchWithCsrf(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: chosen.data }),
      });
      const parsed = chatNotificationSettingsSchema.safeParse(
        response.ok ? await response.json() : null
      );
      if (!parsed.success) throw new Error('save failed');
      setLevel(parsed.data.level);
    } catch {
      setLevel(previous);
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
        disabled={saving}
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
