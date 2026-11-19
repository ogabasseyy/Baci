/** Body GIG expects with the 200 that stops its retries. */
export const GIGL_WEBHOOK_ACKNOWLEDGEMENT = {
  status: 'success',
  message: 'Webhook received successfully',
} as const;

/** Webhook answers are never cacheable. */
export const GIGL_WEBHOOK_NO_STORE = { 'Cache-Control': 'no-store' } as const;
