export function maskPayoutAccountNumber(accountNumber: string) {
  if (accountNumber.length <= 4) return '••••';
  return `••••${accountNumber.slice(-4)}`;
}
