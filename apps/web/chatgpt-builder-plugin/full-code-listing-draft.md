# Full-code listing draft — not ready to upload

This is proposed copy for the Baci app, not a statement that the live
connection already supports these features. Reconcile it with the deployed
tool inventory, verified account-linking flow, actual privacy practices and
OpenAI's current listing requirements before incorporating it into the plugin.

**Display name:** Baci Website Builder

**Short description:** Create and preview a custom Baci storefront.

**Proposed description:** Link your Baci merchant account to work on a custom
storefront in ChatGPT. Describe the design and interactions you want, create a
private full-code candidate, and preview it with your store's supported commerce
data. Review changes in Baci before applying them. Publishing requires a
separate confirmation from the signed-in store owner.

Your storefront uses Baci's commerce capabilities for supported catalog, cart,
and checkout flows. Availability depends on your store's configuration and the
tools enabled for your account. This app does not place an order or make a
payment for you.

**Proposed starter prompt:** Help me create a custom storefront for my Baci
store, preview it privately, and show me what needs my approval.

## Before using this copy

- A separate `full-code-review-metadata.draft.json` records the proposed listing,
  five positive cases and three negative cases in the single-server submission
  field shape. It is not a plugin manifest or an upload-ready package. All cases
  remain unrun against the intended ChatGPT connection; reconcile their exact
  tool calls and expected results with that connection before packaging.
- On 13 November, the public Baci home, contact, terms and privacy URLs were
  accessible. The home page describes Baci generally, not this particular
  ChatGPT builder. The privacy page's merchant AI connector section describes
  read-only access and does not establish this builder's OAuth, source upload,
  preview, retention or downstream processing practices. Review and publish
  accurate coverage before treating these URLs as submission-ready; do not
  invent terms or retention periods.
- Verify the linked-account, full-code build, preview, approval and commerce
  statements through the actual ChatGPT connection using synthetic merchants.
- Confirm the exact approval boundary for applying a draft and publishing; do
  not describe an approval intent as a completed change or live publication.
- Confirm and operate retention and deletion for the builder's actual records.
  The local broker schema stores encrypted session material, provider records
  and sealed browser transactions; `provider-storage.ts` and `storage.ts`
  reject expired records on reads, but their expiry is not evidence that they
  have been deleted. The broker README explicitly calls for scheduled bounded
  cleanup. Uploaded source and build artifacts have separate lifecycle and
  retention requirements. Verify the deployed cleanup, backups and deletion
  behavior before making retention claims in the policy.
- Confirm that the privacy policy covers OAuth, uploaded source, private
  previews, retention and the actual third parties involved. The current
  read-only connector wording is not sufficient evidence for this builder.
- Match the copy and supported scope to the final tool registry and reviewer
  instructions. Record unsupported requests and avoid promises about delivery,
  performance, or outcomes that have not been verified.
- Prepare working reviewer access and a real demo after the production
  connection is qualified. Keep credentials out of the package.
