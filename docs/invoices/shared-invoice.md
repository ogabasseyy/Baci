# Shared merchant invoice

`packages/shared/src/receipt/generate-receipt-html.ts` owns the invoice and receipt layout. The Baci admin app, customer app, web preview, PDF downloads, and emailed invoice PDFs use this generator. Do not add another PDF layout or place payment accounts in a separate template.

For unpaid and partially paid invoices, the shared payment section shows:

- **Automatic Confirmation** from `order.virtual_account`, the persisted customer DVA.
- **Manual Confirmation** from `merchant.bank_account_number`, with the merchant bank name and account name.

Each section requires its own available account details. A missing customer DVA must not be replaced with a staff terminal or merchant bank account in the automatic section. The existing server-validated DVA provisioning flow is preserved; exporting never initiates a payment. Fully paid documents omit payment instructions.

Server PDF generation is asynchronous: `await generateReceiptBlob(...)`. It renders the shared HTML through Chromium with JavaScript disabled and external network/file requests blocked. Logos are resolved into capped, trusted image bytes by `receipt-logo.ts` before rendering. Browser processes close after success or failure, and exports are serialized per worker to bound memory. Invoice dates, buyer references, tax subtotals, payment terms, FIRS references and notes are optional shared document fields. UBL XML remains a separate machine-readable artifact.

## Runtime packaging

Production uses the pinned `puppeteer-core` and `@sparticuz/chromium` dependencies, under Node 24. Next.js keeps these packages external and traces the Chromium archives from the renderer's filesystem paths. The Build job checks the emitted route traces against the 250 MiB package budget and performs a cold Linux render using the pinned Chromium and Puppeteer versions. The runtime check reports extracted scratch usage and peak RSS of the largest individual process, with a 512 MiB ceiling for each. Verify aggregate memory separately in the deployed function. Local macOS smoke checks use installed Google Chrome in regular headless mode. Linux uses the packaged Chromium headless shell, so check the Linux build smoke for the production browser path. A production release must verify the traced browser files, a rendered invoice download, and an email attachment through the approved deployment flow.

This change unifies document rendering. It does not repair historical payment assignments, replay webhooks, or prove production payment reconciliation.
