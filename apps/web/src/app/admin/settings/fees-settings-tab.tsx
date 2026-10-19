'use client';

import type { PlatformSettingsResponse } from '@/app/api/admin/settings/route';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import type { PlatformSettingsUpdater } from './settings-types';

type FeeField = {
  description: string;
  field:
    | 'payment_processor_fee_flat'
    | 'payment_processor_fee_percentage'
    | 'platform_fee_flat'
    | 'platform_fee_percentage';
  id: string;
  label: string;
  max?: number;
  placeholder: string;
  suffix: 'currency' | 'percent';
};

const platformFeeFields: FeeField[] = [
  {
    description: 'Percentage of each transaction that goes to the platform.',
    field: 'platform_fee_percentage',
    id: 'fee_percent',
    label: 'Platform Fee (%)',
    max: 100,
    placeholder: '0.00',
    suffix: 'percent',
  },
  {
    description: 'Fixed amount charged per transaction (in addition to %).',
    field: 'platform_fee_flat',
    id: 'fee_flat',
    label: 'Platform Flat Fee (NGN)',
    placeholder: '0.00',
    suffix: 'currency',
  },
];

const processorFeeFields: FeeField[] = [
  {
    description: 'Korapay/Paystack percentage fee.',
    field: 'payment_processor_fee_percentage',
    id: 'processor_percent',
    label: 'Processor Fee (%)',
    max: 100,
    placeholder: '1.50',
    suffix: 'percent',
  },
  {
    description: 'Korapay/Paystack flat fee per transaction.',
    field: 'payment_processor_fee_flat',
    id: 'processor_flat',
    label: 'Processor Flat Fee (NGN)',
    placeholder: '100.00',
    suffix: 'currency',
  },
];

type FeesSettingsTabProps = {
  onSettingChange: PlatformSettingsUpdater;
  settings: PlatformSettingsResponse;
};

export function FeesSettingsTab({
  onSettingChange,
  settings,
}: FeesSettingsTabProps) {
  const platformFee =
    (settings.platform_fee_percentage / 100) * 10000 +
    settings.platform_fee_flat;
  const processorFee =
    (settings.payment_processor_fee_percentage / 100) * 10000 +
    settings.payment_processor_fee_flat;
  const renderField = (field: FeeField) => (
    <div className="space-y-2" key={field.id}>
      <Label htmlFor={field.id}>{field.label}</Label>
      <div className="relative">
        {field.suffix === 'currency' ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            ₦
          </span>
        ) : null}
        <Input
          id={field.id}
          type="number"
          step="0.01"
          min="0"
          max={field.max}
          placeholder={field.placeholder}
          value={settings[field.field] || ''}
          onChange={(event) =>
            onSettingChange(
              field.field,
              Number.parseFloat(event.target.value) || 0
            )
          }
          className={field.suffix === 'currency' ? 'pl-8' : 'pr-8'}
        />
        {field.suffix === 'percent' ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            %
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{field.description}</p>
    </div>
  );
  return (
    <TabsContent value="fees" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Platform Fees</CardTitle>
          <CardDescription>
            Configure the fees you charge merchants on each transaction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {platformFeeFields.map(renderField)}
          </div>
          <div className="border-t pt-6">
            <h4 className="mb-4 text-sm font-medium">
              Payment Processor Fees (for reference)
            </h4>
            <div className="grid gap-6 md:grid-cols-2">
              {processorFeeFields.map(renderField)}
            </div>
          </div>
          <div className="border-t pt-6">
            <h4 className="mb-4 text-sm font-medium">Fee Calculator Preview</h4>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="mb-2 text-sm text-muted-foreground">
                For a ₦10,000 transaction:
              </p>
              <ul className="space-y-1 text-sm">
                <li className="flex justify-between">
                  <span>Platform Fee:</span>
                  <span className="font-medium">₦{platformFee.toFixed(2)}</span>
                </li>
                <li className="flex justify-between">
                  <span>Processor Fee:</span>
                  <span className="font-medium">
                    ₦{processorFee.toFixed(2)}
                  </span>
                </li>
                <li className="mt-1 flex justify-between border-t pt-1">
                  <span className="font-medium">Net to Merchant:</span>
                  <span className="font-bold text-green-600">
                    ₦{(10000 - platformFee - processorFee).toFixed(2)}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
