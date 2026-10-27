'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SetupInstructions } from '@/components/analytics/setup-instructions';
import { TrackingPixelSection } from '@/components/dashboard/integrations/tracking-pixel-section';
import { Button } from '@/components/ui/button';
import { useIntegrationSettings } from '@/hooks/use-integration-settings';
import { asRoute } from '@/lib/routes';

interface SnapchatSettings {
  snapchat_pixel_id: string | null;
  snapchat_capi_token: string | null;
  snapchat_capi_token_configured: boolean;
}

const SETTINGS_KEYS: (keyof SnapchatSettings)[] = [
  'snapchat_pixel_id',
  'snapchat_capi_token',
  'snapchat_capi_token_configured',
];

export default function SnapchatIntegrationPage() {
  const { settings, isLoading, hasMerchant, saveSettings } =
    useIntegrationSettings<SnapchatSettings>({
      keys: SETTINGS_KEYS,
      platformName: 'Snapchat',
    });

  const handleSave = async (pixelId: string, token: string) => {
    await saveSettings({
      snapchat_pixel_id: pixelId || null,
      ...(token.trim() ? { snapchat_capi_token: token.trim() } : {}),
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
          <h1 className="text-2xl font-bold tracking-tight">Snapchat Ads</h1>
          <p className="text-muted-foreground">
            Track conversions from your Snapchat campaigns
          </p>
        </div>
      </div>

      <TrackingPixelSection
        platform="Snapchat"
        pixelId={settings?.snapchat_pixel_id || ''}
        tokenConfigured={settings?.snapchat_capi_token_configured === true}
        onDisconnect={() => saveSettings({ snapchat_capi_token: null })}
        pixelLabel="Snap Pixel ID"
        tokenLabel="Conversion API Token (Optional)"
        onSave={handleSave}
        description="The Snap Pixel helps you measure the cross-device impact of your campaigns."
      >
        <SetupInstructions platform="snapchat" />
      </TrackingPixelSection>
    </div>
  );
}
