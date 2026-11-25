/**
 * Rows per page of the chat engine's message list, hidden rows (private notes,
 * activity lines) included: the engine's message finder returns at most this
 * many (`limit(20)` in v4.19.1, checked in its source). A page with fewer rows
 * is the oldest one. Re-check this when the engine is upgraded: a smaller
 * limit would hide older messages.
 */
export const PROVIDER_MESSAGE_PAGE_SIZE = 20;
