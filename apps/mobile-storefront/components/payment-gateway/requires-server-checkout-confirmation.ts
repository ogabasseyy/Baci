export function requiresServerCheckoutConfirmation(
  paymentMethod?: string,
  paymentKind?: string
) {
  return (
    paymentMethod === 'uba_redvault' || paymentKind === 'primary_wallet_card'
  );
}
