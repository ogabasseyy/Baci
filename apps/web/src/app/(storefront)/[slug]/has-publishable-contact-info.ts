function hasNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasPublishableContactInfo(
  merchant: {
    pages?: { contact?: string | null } | null;
    email?: string | null;
    phone?: string | null;
  },
  trustProfile: {
    supportEmail?: string;
    supportPhone?: string;
  }
): boolean {
  return [
    merchant.pages?.contact,
    merchant.email,
    merchant.phone,
    trustProfile.supportEmail,
    trustProfile.supportPhone,
  ].some(hasNonEmptyText);
}
