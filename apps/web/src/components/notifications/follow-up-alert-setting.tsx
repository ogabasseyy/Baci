'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface FollowUpAlertSettingProps {
  enabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function FollowUpAlertSetting({
  enabled,
  onCheckedChange,
}: FollowUpAlertSettingProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label htmlFor="follow_up_alerts">Follow-up Alerts</Label>
        <p className="text-sm text-muted-foreground">
          Alert me when a customer creates an invoice that needs follow-up
        </p>
      </div>
      <Switch
        id="follow_up_alerts"
        checked={enabled}
        onCheckedChange={onCheckedChange}
        aria-label="Follow-up alerts"
      />
    </div>
  );
}
