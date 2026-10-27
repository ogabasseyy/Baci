# Set up ChatGPT Ads measurement

Captured from Ads Manager on 24 October 2026. These genuine provider screens
have account-specific values masked. Each merchant must use their own account
and Pixel ID, and keep server conversion keys private.

## 1. Create a website data source

In Ads Manager, open **Conversions → Data Source → Create data source**. Give it
your store's name, review the Conversion Terms, and create it. Copy the Pixel ID
from the setup screen. A Pixel ID is a public identifier; it is not a CAPI key.

![The website pixel setup screen](screenshots/01-pixel-setup.png)

## 2. Define the paid conversion

Choose **Next: create conversion event**. Select your website source, choose
**Order created** as the base event, and name the conversion **Successful
payment**. Attribution-window values are masked in this example; these are
reporting settings, not a reason to change payment behavior.

The label alone does not enforce payment success. Your application must emit
this event only after the server confirms the order is paid. Never emit it on
an unpaid order, invoice creation, payment initiation, or an unverified return
URL.

![Choose the data source and paid conversion](screenshots/02-successful-payment.png)

After creating the conversion, open **Conversion Events** and confirm it is
listed. This confirms configuration only; it does not prove that browser or
server events have been delivered.

![Configured conversion listed, with account fields masked](screenshots/06-conversion-created.png)

## 3. Install the browser Pixel

The **Pixel** tab shows the event call. Baci's integration should load the SDK
once, initialize it with the merchant's Pixel ID, and respect the storefront's
Analytics consent. Merchants should not paste a second copy into their theme
after enabling the Baci integration.

![Browser conversion event instructions](screenshots/03-pixel-event.png)

## 4. Configure server conversions

The **Conversions API** tab shows the server request. The CAPI key belongs on
the server. Never put it in theme HTML, client JavaScript, a public environment
variable, a support screenshot, or a chat message.

![Server conversion request with placeholders only](screenshots/04-capi-event.png)

Select **Create conversion key**, give it a recognizable name, and create it.
Store the generated secret through the server integration's secure setup path.
The screenshot below stops before generating a secret.

![Name the server conversion key](screenshots/05-create-capi-key.png)

Send the confirmed order total and currency. OpenAI amounts use integer minor
units: NGN 12,500 becomes 1,250,000 kobo. Browser and server copies must use the
same Pixel ID, event name, and event ID so they count once. Retries must reuse
the original event ID and payment event time.

Preserve the Pixel's `__oppref` click reference and `__obref` browser reference
with the checkout attribution when available. Send only eligible matching data;
customer identifiers must be normalized and SHA-256 hashed as documented.

## 5. Validate before enabling campaigns

Use CAPI's `validate_only: true` for payload validation, then a controlled test
event and **Event Stream / Diagnostics** to confirm ingestion. An accepted
event is not proof of ad attribution or a real customer payment. Never label a
synthetic event as a real sale. Validate that unpaid, failed, pending, partial,
and cancelled payments do not emit the paid conversion, and that refreshing a
confirmation page cannot create a second conversion.

Select **Successful payment** as the conversion goal when creating an approved
conversion campaign. Creating a source and event does not install code, connect
a campaign, activate ads, or authorize spend.

## Official references

- [Measurement Pixel](https://developers.openai.com/ads/measurement-pixel)
- [Conversions API](https://developers.openai.com/ads/conversions-api)
- [Supported events](https://developers.openai.com/ads/supported-events)
- [Ads Manager reporting](https://help.openai.com/en/articles/20001214-measure-results)

The screenshots represent the captured UI, which can change. For payload and
SDK behavior, follow the current developer references.

[Local validation and remaining production rollout](validation.md).
