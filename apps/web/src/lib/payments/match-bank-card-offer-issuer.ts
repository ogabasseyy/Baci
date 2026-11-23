// Activation requires the bank's verified Paystack issuer label. The
// configured list stays empty until that check, and unknown labels enter
// capture review instead of broadening the issuer rule during settlement.
const labelsByBank = {
  '035': {
    canonical: 'wema bank',
    aliases: ['wema bank plc', 'wema bank limited', 'wema bank ltd'],
  },
  '232': {
    canonical: 'sterling bank',
    aliases: [
      'sterling bank plc',
      'sterling bank limited',
      'sterling bank ltd',
    ],
  },
} as const;

function normalizeLabel(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

export function matchBankCardOfferIssuer(
  bankCode: string,
  savedLabel: string,
  providerLabel: string
): boolean {
  if (bankCode !== '035' && bankCode !== '232') return false;
  const bank = labelsByBank[bankCode];
  if (normalizeLabel(savedLabel) !== bank.canonical) return false;
  const normalized = normalizeLabel(providerLabel);
  return (
    bank.canonical === normalized ||
    bank.aliases.some((label) => label === normalized)
  );
}
