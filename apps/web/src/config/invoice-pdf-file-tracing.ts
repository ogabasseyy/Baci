// Chromium can be installed under the web package or hoisted by pnpm.
const chromiumBinFiles = [
  './node_modules/@sparticuz/chromium/bin/**/*',
  '../../node_modules/@sparticuz/chromium/bin/**/*',
];

export const INVOICE_PDF_FILE_TRACING_INCLUDES = {
  '/api/orders{,/**}': chromiumBinFiles,
  '/api/storefront/account/orders/**': chromiumBinFiles,
  '/api/cron/order-notifications': chromiumBinFiles,
};
