import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type AdPlatform = 'facebook' | 'tiktok' | 'snapchat' | 'x';

const guides: Record<AdPlatform, { name: string; steps: string[] }> = {
  facebook: {
    name: 'Meta',
    steps: [
      'In Meta Events Manager, select the website Pixel already connected to your product catalog, if you have one.',
      'Copy that Pixel ID and create or retrieve its Conversions API access token. Keep the token private.',
      'Enter the Pixel ID and token in this Baci page, then save. Baci manages the storefront event wiring; do not add a second pixel script.',
      'Grant Analytics consent to load the Meta Pixel and check Test Events for browser activity. The Marketing preference controls Meta data processing options. Check server delivery separately; a saved setting is not a delivery receipt.',
    ],
  },
  tiktok: {
    name: 'TikTok',
    steps: [
      'In TikTok Ads Manager, open Events and select the website Pixel for this store.',
      'Copy the Pixel ID and, when setting up server events, the Events API access token.',
      'Enter the values in this Baci page and save. Keep the token private and do not install a duplicate pixel script.',
      'Grant Marketing consent on your storefront, then verify browser and server events separately in TikTok Events Manager.',
    ],
  },
  snapchat: {
    name: 'Snapchat',
    steps: [
      'In Snapchat Ads Manager, open Events Manager and select the existing business Pixel for this store.',
      'Copy its Pixel ID. For server events, use the Conversions API token created for that Pixel.',
      'Enter the Pixel ID and token in this Baci page, then save. Keep the token private; Baci manages event wiring.',
      'Grant Marketing consent on your storefront and check the provider event view. Confirm browser activity and server delivery as separate results.',
    ],
  },
  x: {
    name: 'X',
    steps: [
      'In X Ads Events Manager, select the existing website Pixel for this store.',
      'Copy its Pixel ID and the event codes for the events you plan to send. Each event code must belong to the selected Pixel.',
      'Enter the Pixel ID and event codes in this Baci page. Configure one server credential method: a Pixel access token or the four OAuth credentials.',
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
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
