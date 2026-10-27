# Ad tracking screenshot review checklist

SHA-256 pins in tests detect binary changes. They do not determine whether an
image is private or prove that a redaction is present. Before changing a pin,
open the changed image at full size and confirm the checks below; keep this
checklist aligned with the images used by the merchant guides.

## Baci provider settings

- [ ] `meta-settings.jpg`: Pixel ID, store domain, and token state are masked.
- [ ] `tiktok-settings.jpg`: Pixel ID is masked; the token field shows only the
      generic saved-value notice, no token value; the full fields and Save
      Changes control are visible.
- [ ] `snapchat-pixel-settings.jpg`: store domain and Pixel ID are masked; the
      optional token field is empty.
- [ ] `x-connection-settings.jpg`: no account identity or Pixel ID is shown;
      credential fields are blank and the crop begins at a complete field label
      without clipping any text or form controls.

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
