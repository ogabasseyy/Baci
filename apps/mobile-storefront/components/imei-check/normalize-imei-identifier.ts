/**
 * One device, one identifier, however it was typed (spaces, dashes, case).
 * Every key and every request body for a check uses this form, so a replay
 * with the same key always sends the same IMEI (Muse).
 */
export const normalizeImeiIdentifier = (identifier: string) =>
  identifier.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
