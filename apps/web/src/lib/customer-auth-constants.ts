// Keep the sign-in countdown aligned with the customer auth challenge window.
export const CUSTOMER_OTP_TTL_SECONDS = 3600;

/** Separate from the OTP validity period and the server-side rate limit. */
export const CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS = 30;
