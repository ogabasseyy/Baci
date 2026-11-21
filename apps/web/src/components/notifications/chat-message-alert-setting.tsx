'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import { chatNotificationSettingsSchema } from '@/schemas/chat-notification-settings';

const ENDPOINT = '/api/merchant/chat-notifications';

/**
 * Push-alert switch for new customer chat messages. It loads its own state
 * and renders nothing unless the server says chat is available for this
 * store, so other merchants never see it.
 */
export function ChatMessageAlertSetting() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stale = false;
    fetch(ENDPOINT)
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = chatNotificationSettingsSchema.safeParse(
          await response.json()
        );
        return parsed.success ? parsed.data.push_enabled : null;
      })
      .then((value) => {
        if (!stale) setEnabled(value);
      })
      .catch(() => {
        if (!stale) setEnabled(null);
      });
    return () => {
      stale = true;
    };
  }, []);

  if (enabled === null) return null;

  const change = async (checked: boolean) => {
    const previous = enabled;
    setEnabled(checked);
    setSaving(true);
    try {
      const response = await fetchWithCsrf(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push_enabled: checked }),
      });
      const parsed = chatNotificationSettingsSchema.safeParse(
        response.ok ? await response.json() : null
      );
      if (!parsed.success) throw new Error('save failed');
      setEnabled(parsed.data.push_enabled);
    } catch {
      setEnabled(previous);
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
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label htmlFor="chat_message_alerts">Customer Chat Alerts</Label>
        <p className="text-sm text-muted-foreground">
          Send a push to your merchant app when a customer messages your store
        </p>
      </div>
      <Switch
        id="chat_message_alerts"
        checked={enabled}
        disabled={saving}
        onCheckedChange={change}
        aria-label="Customer chat alerts"
      />
    </div>
  );
}
