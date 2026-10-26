'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SetupInstructions } from '@/components/analytics/setup-instructions';
import { TrackingPixelSection } from '@/components/dashboard/integrations/tracking-pixel-section';
import { Button } from '@/components/ui/button';
import { useIntegrationSettings } from '@/hooks/use-integration-settings';
import { asRoute } from '@/lib/routes';

interface FacebookSettings {
  facebook_pixel_id: string | null;
  facebook_capi_token: string | null;
  facebook_capi_token_configured: boolean;
}

const SETTINGS_KEYS: (keyof FacebookSettings)[] = [
  'facebook_pixel_id',
  'facebook_capi_token',
  'facebook_capi_token_configured',
];

export default function FacebookIntegrationPage() {
  const { settings, isLoading, hasMerchant, saveSettings } =
    useIntegrationSettings<FacebookSettings>({
      keys: SETTINGS_KEYS,
      platformName: 'Facebook',
    });

  const handleSave = async (pixelId: string, token: string) => {
    await saveSettings({
      facebook_pixel_id: pixelId || null,
      ...(token.trim() ? { facebook_capi_token: token.trim() } : {}),
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
          <h1 className="text-2xl font-bold tracking-tight">Facebook Pixel</h1>
          <p className="text-muted-foreground">
            Track conversions and optimize your Facebook ad campaigns
          </p>
        </div>
      </div>

      <TrackingPixelSection
        platform="Facebook"
        pixelId={settings?.facebook_pixel_id || ''}
        tokenConfigured={settings?.facebook_capi_token_configured === true}
        onDisconnect={() => saveSettings({ facebook_capi_token: null })}
        pixelLabel="Pixel ID"
        tokenLabel="Conversion API Access Token"
        onSave={handleSave}
      >
        <SetupInstructions platform="facebook" />
      </TrackingPixelSection>
    </div>
  );
}
