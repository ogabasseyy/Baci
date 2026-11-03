export const PAYMENT_PAGE_INTERACTIVE_MESSAGE = 'baci_payment_page_interactive';

// Only report the top-level document. Readiness controls the loading UI; it
// is never used as evidence that a payment was made.
export const PAYMENT_PAGE_INTERACTIVE_SCRIPT = `
(function () {
  if (window.top !== window || window.__baciPaymentPageInteractiveReported) return true;
  function reportInteractive() {
    if (!window.__baciPaymentPageInteractiveReported && window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${PAYMENT_PAGE_INTERACTIVE_MESSAGE}' }));
      window.__baciPaymentPageInteractiveReported = true;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportInteractive, { once: true });
  } else {
    reportInteractive();
  }
  return true;
})();
`;
