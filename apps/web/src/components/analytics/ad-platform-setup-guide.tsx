import { ExternalLink } from 'lucide-react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type AdPlatform = 'facebook' | 'tiktok' | 'snapchat' | 'x';

type GuideScreenshot = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

type Guide = {
  name: string;
  consoleUrl: string;
  consoleLabel: string;
  steps: string[];
  screenshots?: GuideScreenshot[];
};

const guides: Record<AdPlatform, Guide> = {
  facebook: {
    name: 'Meta',
    consoleUrl: 'https://business.facebook.com/events_manager',
    consoleLabel: 'Open Meta Events Manager',
    screenshots: [
      {
        src: '/guides/ad-platforms/meta-settings.jpg',
        alt: 'Meta Pixel and Conversions API settings in Baci; Pixel ID and token fields are blank',
        width: 1165,
        height: 353,
      },
    ],
    steps: [
      'In Meta Events Manager, open Connect Data Sources → Web → Meta Pixel to create a Pixel, or select the website Pixel already connected to your product catalog, if you have one.',
      'Copy the Pixel ID from its overview. For server-side events, open Pixel Settings → Generate Access Token to create or retrieve its Conversions API access token; this is optional for browser-only tracking.',
      'Enter the Pixel ID and, if enabling server-side events, the token in this Baci page, then save. Baci manages the storefront event wiring; do not add a second pixel script.',
      'Grant Analytics consent to load the Meta Pixel and check Test Events for browser activity. Meta Limited Data Use is a separate setting from storefront consent. Check server delivery separately; a saved setting is not a delivery receipt.',
    ],
  },
  tiktok: {
    name: 'TikTok',
    consoleUrl: 'https://ads.tiktok.com/',
    consoleLabel: 'Open TikTok Ads Manager',
    screenshots: [
      {
        src: '/guides/ad-platforms/tiktok-settings.jpg',
        alt: 'TikTok Tracking settings in Baci; Pixel ID and Access Token fields are blank',
        width: 1124,
        height: 250,
      },
    ],
    steps: [
      'In TikTok Ads Manager, open Tools → Events → Connect data source → Web to create a Pixel, or select the website Pixel for this store.',
      'Copy the Pixel ID from its details. For server-side events, open Pixel Settings → Generate Access Token to create or retrieve the Events API access token; this is optional for browser-only tracking.',
      'Enter the Pixel ID and, if enabling server-side events, the token in this Baci page and save. Keep the token private and do not install a duplicate pixel script.',
      'Grant Marketing consent on your storefront, then verify browser and server events separately in TikTok Events Manager.',
    ],
  },
  snapchat: {
    name: 'Snapchat',
    consoleUrl: 'https://ads.snapchat.com/',
    consoleLabel: 'Open Snapchat Ads Manager',
    screenshots: [
      {
        src: '/guides/ad-platforms/snapchat-pixel-settings.jpg',
        alt: 'Snapchat Tracking settings in Baci; Snap Pixel ID is blank and the token input shows only its placeholder',
        width: 1165,
        height: 350,
      },
    ],
    steps: [
      'In Snapchat Ads Manager, open Events Manager and create a Snap Pixel, or select the existing business Pixel for this store.',
      'Copy its Pixel ID. For server-side events, in Ads Manager open the menu → Business Details → OAuth Apps → Conversions API Tokens and generate a token; you must be an Organization Admin to access this section. This token is optional for browser-only tracking.',
      'Enter the Pixel ID and, if enabling server-side events, the token in this Baci page, then save. Keep the token private; Baci manages event wiring.',
      'Grant Marketing consent on your storefront and check the provider event view. Confirm browser activity and server delivery as separate results.',
    ],
  },
  x: {
    name: 'X',
    consoleUrl: 'https://ads.x.com/',
    consoleLabel: 'Open X Ads Manager',
    screenshots: [
      {
        src: '/guides/ad-platforms/x-connection-settings.jpg',
        alt: 'X screenshot of the optional server credential fields in Baci; all input values are blank',
        width: 700,
        height: 522,
      },
    ],
    steps: [
      'In X Ads Events Manager, create a website Pixel for this store, or select its existing Pixel.',
      'Copy its Pixel ID and the event codes for the events you plan to send. Each event code must belong to the selected Pixel.',
      'Enter the Pixel ID and event codes in this Baci page. Server credentials are optional for browser-only tracking; to enable server events, configure one method: a Pixel access token or all four OAuth credentials.',
      'Grant Marketing consent on your storefront, then verify browser and server events in X Events Manager separately. Use Successful payment only for a fully paid order confirmed by Baci.',
    ],
  },
};

export function AdPlatformSetupGuide({ platform }: { platform: AdPlatform }) {
  const guide = guides[platform];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{guide.name} setup guide</CardTitle>
        <CardDescription>
          Keep access tokens, keys, and OAuth credentials private. Pixel IDs and
          event codes belong to one store; do not copy them from examples.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a
          href={guide.consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {guide.consoleLabel}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {guide.screenshots?.length ? (
          <div className="mt-6 space-y-3">
            <h3 className="font-medium">Baci settings screenshots</h3>
            <p className="text-sm text-muted-foreground">
              These genuine settings screens show blank or masked values and
              omit saved-credential indicators. Enter values from your own
              provider account; never copy credentials from an image.
            </p>
            {platform === 'x' ? (
              <p className="text-sm text-muted-foreground">
                This cropped screenshot starts at the optional server credential
                fields. Enter Pixel ID and event codes in their separate fields
                above.
              </p>
            ) : null}
            {guide.screenshots.map((screenshot) => (
              <Image
                key={screenshot.src}
                src={screenshot.src}
                alt={screenshot.alt}
                width={screenshot.width}
                height={screenshot.height}
                className="h-auto w-full rounded-lg border"
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
