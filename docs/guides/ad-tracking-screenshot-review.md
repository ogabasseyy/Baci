# Ad tracking screenshot review checklist

SHA-256 pins in tests detect binary changes. They do not determine whether an
image is private or prove that a redaction is present. Before changing a pin,
open the changed image at full size and confirm the checks below; keep this
checklist aligned with the images used by the merchant guides.

## Baci provider settings

- [ ] `meta-settings.jpg`: Pixel ID and Conversions API token fields are blank
      or masked; no store domain is shown.
- [ ] `tiktok-settings.jpg`: Pixel ID and saved-token status are masked; the
      crop contains only the complete Pixel ID and Access Token fields, with no
      save/disconnect controls or saved-connection state.
- [ ] `snapchat-pixel-settings.jpg`: Pixel ID is masked and the optional token
      field is empty; no store domain is shown.
- [ ] `x-connection-settings.jpg`: no account identity or Pixel ID is shown;
      credential fields are blank and the crop ends after the complete fields,
      before any saved-connection state or buttons.

## ChatGPT Ads provider screens

- [ ] `01-pixel-setup.png`: Pixel ID and setup code are masked.
- [ ] `02-successful-payment.png`: data source and attribution values are
      masked.
- [ ] `03-pixel-event.png`: the code example contains no account-specific
      source value.
- [ ] `04-capi-event.png`: the request code block is masked.
- [ ] `05-create-capi-key.png`: account key name and character count are
      masked; no generated key is visible.
- [ ] `06-conversion-created.png`: account-specific fields are masked.

For every image, check that masking covers only the identifying or credential
value, leaves its field label legible, and does not hide unrelated instructions
or controls. Never update a digest solely to make a changed image pass tests.
