/** GIG waybills are numeric today; allow alphanumerics for international. */
export const GIGL_WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/** Standard base64 alphabet with optional padding (GIG's body framing). */
export const GIGL_WEBHOOK_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
