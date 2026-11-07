export function isLegalPagePublishable(
  merchant: {
    template_id?: string | null;
    pages?: { privacy?: string | null; terms?: string | null } | null;
  },
  kind: 'privacy' | 'terms'
): boolean {
  const hasPageContent = Boolean(merchant.pages?.[kind]);
  const templateHasPolicyPage =
    Boolean(merchant.template_id) &&
    merchant.template_id !== 'default' &&
    merchant.template_id !== 'puck';
  return hasPageContent || templateHasPolicyPage;
}
