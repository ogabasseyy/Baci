'use client';

import { BarChart3, DollarSign, Loader2, Save, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  PlatformSettingsResponse,
  PlatformSettingsSecretStatus,
} from '@/app/api/admin/settings/route';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiPut } from '@/lib/api-client';
import { AnalyticsSettingsTab } from './analytics-settings-tab';
import { BrandingSettingsTab } from './branding-settings-tab';
import { FeesSettingsTab } from './fees-settings-tab';
import {
  EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS,
  type PlatformSettingsSecretInputs,
} from './settings-payload';
import type { EditablePlatformSettings } from './settings-types';
import {
  type PlatformSettingsFormErrors,
  validatePlatformSettingsForm,
} from './settings-validation';

async function loadPlatformSettings(): Promise<{
  data: PlatformSettingsResponse | null;
  ok: boolean;
}> {
  try {
    const response = await fetch('/api/admin/settings');
    if (!response.ok) throw new Error('Failed to fetch settings');
    return {
      data: (await response.json()) as PlatformSettingsResponse,
      ok: true,
    };
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return { data: null, ok: false };
  }
}

async function savePlatformSettings(
  payload: Record<string, unknown>
): Promise<{ data: PlatformSettingsResponse | null; ok: boolean }> {
  try {
    return {
      data: await apiPut<PlatformSettingsResponse>(
        '/api/admin/settings',
        payload
      ),
      ok: true,
    };
  } catch (error) {
    console.error('Failed to save settings:', error);
    return { data: null, ok: false };
  }
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettingsResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [formErrors, setFormErrors] = useState<PlatformSettingsFormErrors>({});
  const [secretInputs, setSecretInputs] =
    useState<PlatformSettingsSecretInputs>(
      EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS
    );
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    loadPlatformSettings().then(({ data, ok }) => {
      if (!active) return;
      if (ok) setSettings(data);
      else
        toast({
          title: 'Error',
          description: 'Failed to load platform settings.',
          variant: 'destructive',
        });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [toast]);

  const handleSave = async () => {
    if (!settings) return;
    const validation = validatePlatformSettingsForm(settings, secretInputs);
    if (!validation.success) {
      setFormErrors(validation.errors);
      toast({
        title: 'Fix validation errors',
        description: 'Review the highlighted settings and try again.',
        variant: 'destructive',
      });
      return;
    }
    setFormErrors({});
    setSaving(true);
    const { data: updated, ok } = await savePlatformSettings(
      validation.payload
    );
    if (ok && updated) {
      setSettings(updated);
      setSecretInputs(EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS);
      toast({
        title: 'Settings Saved',
        description: 'Platform settings have been updated successfully.',
      });
    } else {
      toast({
        title: 'Error',
        description: 'Failed to save platform settings.',
        variant: 'destructive',
      });
    }
    setSaving(false);
  };

  const updateSetting = <K extends keyof EditablePlatformSettings>(
    key: K,
    value: EditablePlatformSettings[K]
  ) => {
    if (settings) {
      setSettings({ ...settings, [key]: value });
      setFormErrors((current) => {
        const { [key]: _cleared, ...remaining } = current;
        return remaining;
      });
    }
  };
  const updateSecretInput = <K extends keyof PlatformSettingsSecretStatus>(
    key: K,
    value: string
  ) => {
    setSecretInputs((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      const { [key]: _cleared, ...remaining } = current;
      return remaining;
    });
  };
  const toggleSecretVisibility = (key: string) =>
    setShowSecrets((current) => ({ ...current, [key]: !current[key] }));

  if (loading)
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2
          className="size-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading platform settings...</span>
      </div>
    );
  if (!settings)
    return (
      <div className="py-12 text-center text-muted-foreground">
        Failed to load settings. Please try refreshing the page.
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title">Platform Settings</h1>
          <p className="text-muted-foreground">
            Configure your platform analytics, fees, and features.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={handleSave} disabled={saving} aria-busy={saving}>
            {saving ? (
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Save className="mr-2 size-4" aria-hidden="true" />
            )}
            Save Changes
          </Button>
          <p className="sr-only" role="status" aria-live="polite">
            {saving ? 'Saving platform settings.' : ''}
          </p>
        </div>
      </div>
      {Object.keys(formErrors).length > 0 ? (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          Review the highlighted settings: {Object.keys(formErrors).join(', ')}.
        </div>
      ) : null}
      <Tabs defaultValue="analytics" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="fees" className="flex items-center gap-2">
            <DollarSign className="size-4" />
            Fees
          </TabsTrigger>
          <TabsTrigger value="branding" className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Branding
          </TabsTrigger>
        </TabsList>
        <AnalyticsSettingsTab
          settings={settings}
          secretInputs={secretInputs}
          showSecrets={showSecrets}
          onSettingChange={updateSetting}
          onSecretChange={updateSecretInput}
          onToggleSecret={toggleSecretVisibility}
        />
        <FeesSettingsTab settings={settings} onSettingChange={updateSetting} />
        <BrandingSettingsTab
          settings={settings}
          onSettingChange={updateSetting}
        />
      </Tabs>
      <p className="text-center text-xs text-muted-foreground">
        Last updated: {new Date(settings.updated_at).toLocaleString()}
      </p>
    </div>
  );
}
