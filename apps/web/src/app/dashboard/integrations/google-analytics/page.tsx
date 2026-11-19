'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SetupInstructions } from '@/components/analytics/setup-instructions';
import { TrackingPixelSection } from '@/components/dashboard/integrations/tracking-pixel-section';
import { Button } from '@/components/ui/button';
import { useIntegrationSettings } from '@/hooks/use-integration-settings';
import { asRoute } from '@/lib/routes';

interface GoogleAnalyticsSettings {
  google_analytics_id: string | null;
  ga4_api_secret: string | null;
  ga4_api_secret_configured: boolean;
}

const SETTINGS_KEYS: (keyof GoogleAnalyticsSettings)[] = [
  'google_analytics_id',
  'ga4_api_secret',
  'ga4_api_secret_configured',
];

export default function GoogleAnalyticsPage() {
  const { settings, isLoading, hasMerchant, saveSettings } =
    useIntegrationSettings<GoogleAnalyticsSettings>({
      keys: SETTINGS_KEYS,
      platformName: 'Google Analytics',
    });

  const handleSave = async (measurementId: string, apiSecret: string) => {
    await saveSettings({
      google_analytics_id: measurementId || null,
      ...(apiSecret.trim() ? { ga4_api_secret: apiSecret.trim() } : {}),
    });
  };

  if (!hasMerchant || isLoading) {
    return <div>Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={asRoute('/dashboard/integrations')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Google Analytics 4
          </h1>
          <p className="text-muted-foreground">
            Measure traffic and engagement across your store
          </p>
        </div>
      </div>

      <TrackingPixelSection
        platform="Google Analytics 4"
        pixelId={settings?.google_analytics_id || ''}
        tokenConfigured={settings?.ga4_api_secret_configured === true}
        onDisconnect={() => saveSettings({ ga4_api_secret: null })}
        pixelLabel="Measurement ID (G-XXXXXXXXXX)"
        tokenLabel="API Secret (Optional)"
        onSave={handleSave}
        description="Connect your store to GA4 to track visitors, events, and ecommerce data."
      >
        <SetupInstructions platform="google" />
      </TrackingPixelSection>
    </div>
  );
}
