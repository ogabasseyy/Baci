'use client';

import { Bell } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  CreateNotificationInput,
  NotificationChannel,
  TargetSegment,
  TargetType,
} from '@/types/notifications';

const segments: Array<{ value: TargetSegment; label: string }> = [
  { value: 'new', label: 'New Merchants' },
  { value: 'active', label: 'Active Merchants' },
  { value: 'at_risk', label: 'At Risk Merchants' },
];

export function CreateNotificationAudienceDelivery({
  canTargetSpecificMerchants,
  expiresEnabled,
  formData,
  minDateTime,
  onExpiresEnabledChange,
  onScheduleEnabledChange,
  onToggleChannel,
  onUpdate,
  scheduleEnabled,
}: {
  canTargetSpecificMerchants: boolean;
  expiresEnabled: boolean;
  formData: CreateNotificationInput;
  minDateTime: string;
  onExpiresEnabledChange: (enabled: boolean) => void;
  onScheduleEnabledChange: (enabled: boolean) => void;
  onToggleChannel: (channel: NotificationChannel) => void;
  onUpdate: (updates: Partial<CreateNotificationInput>) => void;
  scheduleEnabled: boolean;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Audience</CardTitle>
          <CardDescription>
            Choose which merchants receive this notification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target-type">Target</Label>
            <Select
              value={formData.target_type}
              onValueChange={(value: TargetType) => {
                onUpdate(
                  value === 'all'
                    ? {
                        target_merchant_ids: undefined,
                        target_segment: undefined,
                        target_type: value,
                      }
                    : { target_type: value }
                );
              }}
            >
              <SelectTrigger
                id="target-type"
                aria-describedby={
                  canTargetSpecificMerchants
                    ? undefined
                    : 'specific-merchant-targeting-help'
                }
                aria-label="Target"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Merchants</SelectItem>
                <SelectItem value="segment">Merchant Segment</SelectItem>
                {canTargetSpecificMerchants && (
                  <SelectItem value="specific">Specific Merchants</SelectItem>
                )}
              </SelectContent>
            </Select>
            {!canTargetSpecificMerchants && (
              <p
                id="specific-merchant-targeting-help"
                className="text-xs text-muted-foreground"
              >
                Specific merchant targeting requires merchant read permission.
              </p>
            )}
          </div>
          {formData.target_type === 'segment' && (
            <div className="space-y-2">
              <Label htmlFor="target-segment">Segment</Label>
              <Select
                value={formData.target_segment || ''}
                onValueChange={(value: TargetSegment) =>
                  onUpdate({ target_segment: value })
                }
              >
                <SelectTrigger id="target-segment" aria-label="Segment">
                  <SelectValue placeholder="Select a segment" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((segment) => (
                    <SelectItem key={segment.value} value={segment.value}>
                      {segment.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {formData.target_type === 'specific' && (
            <div className="space-y-2">
              <Label htmlFor="target-merchant-ids">
                Merchant IDs (comma separated)
              </Label>
              <Textarea
                id="target-merchant-ids"
                aria-describedby="target-merchant-ids-help"
                value={(formData.target_merchant_ids ?? []).join(', ')}
                onChange={(event) =>
                  onUpdate({
                    target_merchant_ids: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
              />
              <p
                id="target-merchant-ids-help"
                className="text-xs text-muted-foreground"
              >
                Use merchant IDs from the merchant directory. Invalid or unknown
                IDs are rejected before delivery.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" />
            Delivery
          </CardTitle>
          <CardDescription>Configure how and when to send</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-4">
              {(['in_app', 'banner', 'push'] as NotificationChannel[]).map(
                (channel) => (
                  <Label
                    key={channel}
                    className="flex items-center gap-2 cursor-pointer font-normal"
                  >
                    <Checkbox
                      checked={formData.channels?.includes(channel)}
                      onCheckedChange={() => onToggleChannel(channel)}
                    />
                    <span className="text-sm">
                      {channel === 'in_app'
                        ? 'In-app Notification'
                        : channel === 'banner'
                          ? 'Site Banner'
                          : '📱 Push Notification'}
                    </span>
                  </Label>
                )
              )}
            </div>
            {formData.channels?.includes('push') && (
              <p className="text-xs text-muted-foreground">
                Push notifications will be sent to merchants who have the mobile
                admin app installed.
              </p>
            )}
          </div>
          <DateToggle
            checked={scheduleEnabled}
            id="schedule"
            inputId="scheduled-for"
            label="Schedule for later"
            inputLabel="Schedule date and time"
            minDateTime={minDateTime}
            value={formData.scheduled_for || ''}
            onCheckedChange={onScheduleEnabledChange}
            onValueChange={(scheduled_for) => onUpdate({ scheduled_for })}
          />
          <DateToggle
            checked={expiresEnabled}
            id="expires"
            inputId="expires-at"
            label="Set expiration date"
            inputLabel="Expiration date and time"
            minDateTime={minDateTime}
            value={formData.expires_at || ''}
            onCheckedChange={onExpiresEnabledChange}
            onValueChange={(expires_at) => onUpdate({ expires_at })}
          />
        </CardContent>
      </Card>
    </>
  );
}

function DateToggle({
  checked,
  id,
  inputId,
  inputLabel,
  label,
  minDateTime,
  onCheckedChange,
  onValueChange,
  value,
}: {
  checked: boolean;
  id: string;
  inputId: string;
  inputLabel: string;
  label: string;
  minDateTime: string;
  onCheckedChange: (value: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(!!value)}
        />
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
      </div>
      {checked && (
        <div className="space-y-2">
          <Label htmlFor={inputId}>{inputLabel}</Label>
          <Input
            id={inputId}
            type="datetime-local"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            min={minDateTime}
          />
        </div>
      )}
    </div>
  );
}
