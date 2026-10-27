'use client';

import { AlertCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { FeedUrlSection } from '@/components/dashboard/integrations/feed-url-section';
import { TrackingPixelSection } from '@/components/dashboard/integrations/tracking-pixel-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useIntegrationSettings } from '@/hooks/use-integration-settings';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';

interface TikTokSettings {
  tiktok_pixel_id: string | null;
  tiktok_access_token: string | null;
  tiktok_access_token_configured: boolean;
}

const SETTINGS_KEYS: (keyof TikTokSettings)[] = [
  'tiktok_pixel_id',
  'tiktok_access_token',
  'tiktok_access_token_configured',
];

export default function TikTokIntegrationPage() {
  const { merchant } = useMerchant();
  const { settings, isLoading, hasMerchant, saveSettings } =
    useIntegrationSettings<TikTokSettings>({
      keys: SETTINGS_KEYS,
      platformName: 'TikTok',
    });

  const handleSave = async (pixelId: string, token: string) => {
    await saveSettings({
      tiktok_pixel_id: pixelId || null,
      ...(token.trim() ? { tiktok_access_token: token.trim() } : {}),
    });
  };

  if (!hasMerchant || isLoading) {
    return <div>Loading…</div>;
  }

  const baseUrl = merchant?.custom_domain
    ? `https://${merchant.custom_domain}`
    : `https://${merchant?.slug}.baci.app`;

  const feedUrl = `${baseUrl}/api/feed/tiktok?merchant_slug=${merchant?.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={asRoute('/dashboard/integrations')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TikTok Shopping</h1>
          <p className="text-muted-foreground">
            Sell products through TikTok Shop and TikTok Ads
          </p>
        </div>
      </div>

      <Card className="glass">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Product Catalog Configuration</CardTitle>
              <CardDescription>
                Connect your store to TikTok Seller Center
              </CardDescription>
            </div>
            <svg
              className="size-8"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"
                fill="currentColor"
              />
            </svg>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription>
              TikTok Shopping allows you to showcase products in videos and run
              shoppable ads to reach younger audiences. Perfect for brands
              targeting Gen Z and millennials.
            </AlertDescription>
          </Alert>

          <FeedUrlSection
            id="tiktok-feed-url"
            label="Your Product Catalog Feed URL"
            description="Use this feed in TikTok Seller Center"
            feedUrl={feedUrl}
            platform="TikTok"
          />

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-sm">Setup Instructions:</h4>
            <ol className="space-y-2 text-sm list-decimal list-inside">
              <li>
                Go to{' '}
                <a
                  href="https://seller.tiktok.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  TikTok Seller Center
                  <ExternalLink className="size-3" />
                </a>{' '}
                (or TikTok Ads Manager for ads)
              </li>
              <li>
                Navigate to <strong>Products</strong> →{' '}
                <strong>Product Catalog</strong>
              </li>
              <li>
                Click <strong>Add Data Source</strong>
              </li>
              <li>
                Select <strong>Data Feed</strong>
              </li>
              <li>Paste your feed URL from above</li>
              <li>
                Set update frequency to <strong>Daily</strong>
              </li>
              <li>
                Click <strong>Submit</strong>
              </li>
            </ol>
          </div>

          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription>
              <strong>Tip:</strong> TikTok Shop works best when combined with
              creator partnerships and engaging video content. Consider using
              TikTok Ads Manager to run product-focused campaigns.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <TrackingPixelSection
        platform="TikTok"
        pixelId={settings?.tiktok_pixel_id || ''}
        tokenConfigured={settings?.tiktok_access_token_configured === true}
        onDisconnect={() => saveSettings({ tiktok_access_token: null })}
        pixelLabel="Pixel ID"
        tokenLabel="Access Token"
        onSave={handleSave}
      />
    </div>
  );
}
