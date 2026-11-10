// Chromium can be installed under the web package or hoisted by pnpm.
const chromiumBinFiles = [
  './node_modules/@sparticuz/chromium/bin/**/*',
  '../../node_modules/@sparticuz/chromium/bin/**/*',
];

// Next matches these patterns in substring mode. The suffix anchors each
// pattern so unrelated child routes do not carry the Chromium binaries.
const endOfRoute = '(?![\\s\\S])';

export const INVOICE_PDF_FILE_TRACING_INCLUDES = {
  [`/api/orders${endOfRoute}`]: chromiumBinFiles,
  [`/api/orders/*/invoice${endOfRoute}`]: chromiumBinFiles,
  [`/api/storefront/account/orders/*/{invoice,receipt}${endOfRoute}`]:
    chromiumBinFiles,
  [`/api/cron/order-notifications${endOfRoute}`]: chromiumBinFiles,
};
