import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  {
    title: '1. Create a website data source',
    text: 'In Ads Manager, open Conversions → Data Source → Create data source. Review the Conversion Terms and copy your new Pixel ID.',
  },
  {
    title: '2. Create the successful payment conversion',
    text: 'Choose your data source, select Order created, and name it Successful payment. Baci sends this event after full payment confirmation.',
  },
  {
    title: '3. Connect the Pixel',
    text: 'Paste the Pixel ID into the Baci form above. Baci loads the SDK after measurement consent; you do not need a second theme snippet.',
    image: '03-pixel-event.png',
  },
  {
    title: '4. Create a server key',
    text: 'Open the Conversions API instructions, choose Create conversion key, and give it a recognizable name. Paste the secret into Baci’s Conversions API key field. Never share a screenshot of the generated key.',
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
          The example screen below shows a generic event setup view. It does not
          contain a merchant Pixel ID or credentials. Use values from your own
          Ads Manager account; never copy identifiers from examples or share
          screenshots that reveal your IDs or keys.
        </p>
        {steps.map((step) => (
          <details key={step.title} className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              {step.title}
            </summary>
            <p className="my-3 text-sm">{step.text}</p>
            {step.image ? (
              <Image
                src={`/guides/chatgpt-ads/${step.image}`}
                alt={`${step.title} example screen`}
                width={717}
                height={988}
                className="h-auto w-full max-w-xl rounded-lg"
              />
            ) : null}
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
              Browser events appear after a visitor grants measurement consent.
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
