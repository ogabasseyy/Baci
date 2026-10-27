import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  {
    title: '1. Create a website data source',
    text: 'In Ads Manager, open Conversions → Data Source → Create data source. Review the Conversion Terms and copy your new Pixel ID.',
    images: [
      {
        src: '01-pixel-setup.png',
        alt: 'Create a website data source; the Pixel ID and setup code are masked',
        width: 717,
        height: 384,
      },
    ],
  },
  {
    title: '2. Create the successful payment conversion',
    text: 'Choose your data source, select Order created, and name it Successful payment. Baci sends this event after full payment confirmation.',
    images: [
      {
        src: '02-successful-payment.png',
        alt: 'Create a Successful payment conversion; source and attribution values are masked',
        width: 500,
        height: 552,
      },
    ],
  },
  {
    title: '3. Connect the Pixel',
    text: 'Paste the Pixel ID into the Baci form above. Baci loads the SDK after Analytics consent; you do not need a second theme snippet.',
    images: [
      {
        src: '03-pixel-event.png',
        alt: 'Example order_created browser Pixel event call with account source masked',
        width: 500,
        height: 400,
      },
    ],
  },
  {
    title: '4. Create a server key',
    text: 'Open the Conversions API instructions, choose Create conversion key, and give it a recognizable name. Paste the secret into Baci’s Conversions API key field. Never share a screenshot of the generated key.',
    images: [
      {
        src: '04-capi-event.png',
        alt: 'ChatGPT Ads Conversions API request example with the full code block masked',
        width: 500,
        height: 400,
      },
      {
        src: '05-create-capi-key.png',
        alt: 'Create a conversion key dialog with the account key name and character count masked',
        width: 685,
        height: 214,
      },
    ],
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
                key={image.src}
                src={`/guides/chatgpt-ads/${image.src}`}
                alt={image.alt}
                width={image.width}
                height={image.height}
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
