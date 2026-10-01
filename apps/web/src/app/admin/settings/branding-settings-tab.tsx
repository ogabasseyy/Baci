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

type BrandingField = {
  field:
    | 'platform_logo_url'
    | 'platform_name'
    | 'support_email'
    | 'support_phone';
  id: string;
  label: string;
  placeholder: string;
  type?: 'email';
};

const brandingFields: BrandingField[] = [
  {
    field: 'platform_name',
    id: 'platform_name',
    label: 'Platform Name',
    placeholder: 'Baci',
  },
  {
    field: 'platform_logo_url',
    id: 'platform_logo',
    label: 'Logo URL',
    placeholder: 'https://...',
  },
  {
    field: 'support_email',
    id: 'support_email',
    label: 'Support Email',
    placeholder: 'support@baci.app',
    type: 'email',
  },
  {
    field: 'support_phone',
    id: 'support_phone',
    label: 'Support Phone',
    placeholder: '+234...',
  },
];

type BrandingSettingsTabProps = {
  onSettingChange: PlatformSettingsUpdater;
  settings: PlatformSettingsResponse;
};

export function BrandingSettingsTab({
  onSettingChange,
  settings,
}: BrandingSettingsTabProps) {
  return (
    <TabsContent value="branding" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Platform Branding</CardTitle>
          <CardDescription>
            Customize your platform&apos;s identity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {brandingFields.slice(0, 2).map((field) => (
              <div className="space-y-2" key={field.id}>
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={settings[field.field] || ''}
                  onChange={(event) =>
                    onSettingChange(
                      field.field,
                      field.field === 'platform_name'
                        ? event.target.value
                        : event.target.value || null
                    )
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {brandingFields.slice(2).map((field) => (
              <div className="space-y-2" key={field.id}>
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={settings[field.field] || ''}
                  onChange={(event) =>
                    onSettingChange(field.field, event.target.value || null)
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
