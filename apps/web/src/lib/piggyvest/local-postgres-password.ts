/** Refuse ambient credentials and password challenges on private local trust sockets. */
export function rejectLocalPostgresPassword(): never {
  throw new Error('Local database password authentication is disabled');
}
