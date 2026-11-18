export const CUSTOMER_SELECT_COLUMNS =
  'id, merchant_id, user_id, email, first_name, last_name, phone, loyalty_points, username, username_changed_at, date_of_birth';

export const LEGACY_CUSTOMER_SELECT_COLUMNS =
  'id, merchant_id, user_id, email, first_name, last_name, phone, loyalty_points, username, date_of_birth';

export function isMissingUsernameChangedAtColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';
  return (
    (code === '42703' ||
      code === 'PGRST204' ||
      message.includes('does not exist')) &&
    message.includes('username_changed_at')
  );
}
