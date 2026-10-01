'use client';

import { Eye, EyeOff, Facebook } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  PlatformSettingsResponse,
  PlatformSettingsSecretStatus,
} from '@/app/api/admin/settings/route';
import { Button } from '@/components/ui/button';
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
import type { PlatformSettingsSecretInputs } from './settings-payload';
import type { PlatformSettingsUpdater } from './settings-types';

type AnalyticsProvider = {
  description: string;
  icon: ReactNode;
  name: string;
  pixelField:
    | 'facebook_pixel_id'
    | 'google_analytics_id'
    | 'snapchat_pixel_id'
    | 'tiktok_pixel_id'
    | 'twitter_pixel_id';
  pixelHelpText?: string;
  pixelId: string;
  pixelLabel: string;
  pixelPlaceholder: string;
  secret?: {
    configuredLabel: string;
    inputField: keyof PlatformSettingsSecretInputs;
    inputId: string;
    label: string;
    placeholder: string;
    statusField: keyof PlatformSettingsSecretStatus;
    toggleKey: string;
    toggleLabel: string;
  };
};

const providerIcons = {
  facebook: <Facebook className="size-5 text-blue-600" aria-hidden="true" />,
  ga4: (
    <svg
      className="size-5 text-orange-500"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22.84 2.998a2.157 2.157 0 0 0-2.157-2.16 2.157 2.157 0 1 0 0 4.314 2.157 2.157 0 0 0 2.157-2.154zm-2.157 6.312a2.157 2.157 0 0 0-2.157 2.157v10.376a2.157 2.157 0 0 0 4.314 0V11.467a2.157 2.157 0 0 0-2.157-2.157zM7.157 0A7.157 7.157 0 0 0 0 7.157v9.686a7.157 7.157 0 0 0 14.314 0V7.157A7.157 7.157 0 0 0 7.157 0zm2.843 16.843a2.843 2.843 0 1 1-5.686 0V7.157a2.843 2.843 0 0 1 5.686 0v9.686z" />
    </svg>
  ),
  snapchat: (
    <svg
      className="size-5 text-yellow-400"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.422.422 0 01.493.075c.134.134.15.348.045.51a4.13 4.13 0 01-.39.554.862.862 0 00-.183.39c-.029.189-.009.391.194.596.049.05.096.09.156.136.178.135.333.232.465.315.36.24.63.435.795.645.197.254.229.515.132.765a1.184 1.184 0 01-.555.659c-.418.24-.98.375-1.593.494a4.83 4.83 0 00-.301.081c-.06.022-.12.045-.164.075-.06.045-.07.09-.06.135.03.12.09.21.165.314.064.091.121.165.139.192.271.39.48.69.376 1.022-.082.266-.35.46-.679.595a4.64 4.64 0 01-1.139.33 2.44 2.44 0 00-.449.121c-.123.06-.205.135-.255.24-.118.254-.165.599-.195.93-.042.449-.097.841-.298 1.159-.3.48-.865.72-1.67.72H8.91c-.806 0-1.372-.24-1.67-.72-.2-.318-.256-.71-.3-1.159-.029-.331-.075-.676-.194-.93-.05-.105-.133-.18-.256-.24a2.47 2.47 0 00-.45-.12 4.622 4.622 0 01-1.14-.33c-.328-.135-.597-.33-.68-.596-.103-.33.105-.63.377-1.021.018-.027.074-.1.138-.192.075-.104.135-.194.166-.314.009-.045 0-.09-.061-.135a1.02 1.02 0 00-.165-.075 5.13 5.13 0 00-.3-.082c-.615-.119-1.176-.254-1.594-.495a1.19 1.19 0 01-.555-.66c-.096-.249-.064-.509.133-.764.165-.21.434-.405.795-.645.132-.083.287-.18.465-.315l.156-.136c.203-.205.224-.407.195-.596a.862.862 0 00-.184-.39 4.11 4.11 0 01-.389-.555.358.358 0 01.045-.51.42.42 0 01.494-.075c.374.18.733.285 1.033.3.198 0 .326-.044.401-.09l-.03-.51-.002-.059c-.104-1.628-.23-3.654.299-4.847C7.86 1.069 11.216.793 12.206.793z" />
    </svg>
  ),
  tiktok: (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  ),
  twitter: (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

const providers: AnalyticsProvider[] = [
  {
    name: 'Google Analytics 4',
    description:
      'Track platform traffic, merchant signups, and conversions in your GA4 dashboard.',
    icon: providerIcons.ga4,
    pixelField: 'google_analytics_id',
    pixelId: 'ga4_id',
    pixelLabel: 'Measurement ID',
    pixelPlaceholder: 'G-XXXXXXXXXX',
    pixelHelpText: 'Found in GA4 Admin → Data Streams → Your Stream',
    secret: {
      configuredLabel: 'GA4 API secret',
      inputField: 'ga4_api_secret',
      inputId: 'ga4_secret',
      label: 'API Secret (Server-Side)',
      placeholder: 'xxxxxxxxxxxxxxxx',
      statusField: 'ga4_api_secret',
      toggleKey: 'ga4_secret',
      toggleLabel: 'GA4 API secret',
    },
  },
  {
    name: 'Facebook / Meta',
    description:
      'Track your Facebook/Instagram ad campaigns and merchant signup conversions.',
    icon: providerIcons.facebook,
    pixelField: 'facebook_pixel_id',
    pixelId: 'fb_pixel',
    pixelLabel: 'Pixel ID',
    pixelPlaceholder: '1234567890123456',
    secret: {
      configuredLabel: 'Facebook Conversions API token',
      inputField: 'facebook_capi_token',
      inputId: 'fb_capi',
      label: 'Conversions API Token',
      placeholder: 'EAAxxxxxxxx...',
      statusField: 'facebook_capi_token',
      toggleKey: 'fb_capi',
      toggleLabel: 'Facebook Conversions API token',
    },
  },
  {
    name: 'TikTok',
    description: 'Track TikTok ad campaigns for merchant acquisition.',
    icon: providerIcons.tiktok,
    pixelField: 'tiktok_pixel_id',
    pixelId: 'tiktok_pixel',
    pixelLabel: 'Pixel ID',
    pixelPlaceholder: 'XXXXXXXXXX',
    secret: {
      configuredLabel: 'TikTok Events API token',
      inputField: 'tiktok_access_token',
      inputId: 'tiktok_token',
      label: 'Events API Token',
      placeholder: 'xxxxxxxx...',
      statusField: 'tiktok_access_token',
      toggleKey: 'tiktok_token',
      toggleLabel: 'TikTok Events API token',
    },
  },
  {
    name: 'Snapchat',
    description: 'Track Snapchat ad campaigns for merchant acquisition.',
    icon: providerIcons.snapchat,
    pixelField: 'snapchat_pixel_id',
    pixelId: 'snap_pixel',
    pixelLabel: 'Pixel ID',
    pixelPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx',
    secret: {
      configuredLabel: 'Snapchat Conversions API token',
      inputField: 'snapchat_capi_token',
      inputId: 'snap_capi',
      label: 'Conversions API Token',
      placeholder: 'xxxxxxxx...',
      statusField: 'snapchat_capi_token',
      toggleKey: 'snap_capi',
      toggleLabel: 'Snapchat Conversions API token',
    },
  },
  {
    name: 'Twitter / X',
    description: 'Track Twitter/X ad campaigns (client-side pixel only).',
    icon: providerIcons.twitter,
    pixelField: 'twitter_pixel_id',
    pixelId: 'twitter_pixel',
    pixelLabel: 'Pixel ID',
    pixelPlaceholder: 'xxxxxxxxx',
  },
];

type AnalyticsSettingsTabProps = {
  onSecretChange: (
    key: keyof PlatformSettingsSecretInputs,
    value: string
  ) => void;
  onSettingChange: PlatformSettingsUpdater;
  onToggleSecret: (key: string) => void;
  secretInputs: PlatformSettingsSecretInputs;
  settings: PlatformSettingsResponse;
  showSecrets: Record<string, boolean>;
};

export function AnalyticsSettingsTab({
  onSecretChange,
  onSettingChange,
  onToggleSecret,
  secretInputs,
  settings,
  showSecrets,
}: AnalyticsSettingsTabProps) {
  return (
    <TabsContent value="analytics" className="space-y-6">
      {providers.map((provider) => {
        const secret = provider.secret;
        const configured = secret
          ? settings.secretStatus[secret.statusField]
          : false;
        const visible = secret ? Boolean(showSecrets[secret.toggleKey]) : false;
        return (
          <Card key={provider.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {provider.icon}
                {provider.name}
              </CardTitle>
              <CardDescription>{provider.description}</CardDescription>
            </CardHeader>
            <CardContent className={secret ? 'space-y-4' : undefined}>
              <div
                className={secret ? 'grid gap-4 md:grid-cols-2' : 'space-y-2'}
              >
                <div className="space-y-2">
                  <Label htmlFor={provider.pixelId}>
                    {provider.pixelLabel}
                  </Label>
                  <Input
                    id={provider.pixelId}
                    placeholder={provider.pixelPlaceholder}
                    value={settings[provider.pixelField] || ''}
                    onChange={(event) =>
                      onSettingChange(
                        provider.pixelField,
                        event.target.value || null
                      )
                    }
                  />
                  {provider.pixelHelpText ? (
                    <p className="text-xs text-muted-foreground">
                      {provider.pixelHelpText}
                    </p>
                  ) : null}
                </div>
                {secret ? (
                  <div className="space-y-2">
                    <Label htmlFor={secret.inputId}>{secret.label}</Label>
                    <div className="relative">
                      <Input
                        id={secret.inputId}
                        type={visible ? 'text' : 'password'}
                        placeholder={
                          configured
                            ? 'Stored securely. Enter a new value to replace it.'
                            : secret.placeholder
                        }
                        value={secretInputs[secret.inputField]}
                        onChange={(event) =>
                          onSecretChange(secret.inputField, event.target.value)
                        }
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => onToggleSecret(secret.toggleKey)}
                        aria-label={`${visible ? 'Hide' : 'Show'} ${secret.toggleLabel}`}
                      >
                        {visible ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {configured
                        ? `${secret.configuredLabel} is already stored. Leave this blank to keep the current value.`
                        : `No ${secret.configuredLabel.toLowerCase()} has been configured yet.`}
                    </p>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </TabsContent>
  );
}
