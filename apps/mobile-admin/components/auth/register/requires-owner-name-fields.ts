export function requiresOwnerNameFields(
  firstName: string,
  lastName: string
): boolean {
  return !firstName.trim() || !lastName.trim();
}
