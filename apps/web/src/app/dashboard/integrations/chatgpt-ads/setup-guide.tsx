import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  {
    title: '1. Create a website data source',
    text: 'In Ads Manager, open Conversions → Data Source → Create data source. Review the Conversion Terms and copy your new Pixel ID.',
    images: ['01-pixel-setup.png'],
  },
  {
    title: '2. Create the successful payment conversion',
    text: 'Choose your data source, select Order created, and name it Successful payment. Baci sends this event after full payment confirmation.',
    images: ['02-successful-payment.png'],
  },
  {
    title: '3. Connect the Pixel',
    text: 'Paste the Pixel ID into the Baci form above. Baci loads the SDK after Analytics consent; you do not need a second theme snippet.',
    images: ['03-pixel-event.png'],
  },
  {
    title: '4. Create a server key',
    text: 'Open the Conversions API instructions, choose Create conversion key, and give it a recognizable name. Paste the secret into Baci’s Conversions API key field. Never share a screenshot of the generated key.',
    images: ['04-capi-event.png', '05-create-capi-key.png'],
  },
];
export function ChatgptSetupGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup guide</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          These are genuine provider screens with account-specific values
          masked. Use the Pixel ID and key from your own Ads Manager account; do
          not copy another store’s ID, and keep keys private. Never share
          screenshots that reveal credentials.
        </p>
        {steps.map((step) => (
          <details key={step.title} className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              {step.title}
            </summary>
            <p className="my-3 text-sm">{step.text}</p>
            {step.images?.map((image) => (
              <Image
                key={image}
                src={`/guides/chatgpt-ads/${image}`}
                alt={`${step.title} example screen`}
                width={717}
                height={988}
                className="h-auto w-full max-w-xl rounded-lg"
              />
            ))}
          </details>
        ))}
        <p className="text-sm">
          Save your connection, then verify events under{' '}
          <a
            href="https://ads.openai.com/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Ads Manager → Conversions → Event Stream
          </a>
          . Your account’s delivery rollout must be active before server events
          are sent. Select Successful payment as the goal when setting up a
          conversion campaign.
        </p>
        <div className="rounded-lg border p-4 text-sm">
          <h3 className="mb-2 font-medium">What to verify</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Browser events appear after a visitor grants Analytics consent.
            </li>
            <li>Server delivery is confirmed separately in Event Stream.</li>
            <li>
              Successful payment is sent only after Baci confirms full payment;
              a checkout visit or order creation is not a purchase receipt.
            </li>
          </ul>
        </div>
        <a
          href="https://developers.openai.com/ads/conversions-api"
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          Official conversion setup documentation
        </a>
      </CardContent>
    </Card>
  );
}
