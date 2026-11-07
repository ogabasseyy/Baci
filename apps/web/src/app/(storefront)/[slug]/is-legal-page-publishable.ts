import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

export function isLegalPagePublishable(
  merchant: {
    template_id?: string | null;
    pages?: { privacy?: string | null; terms?: string | null } | null;
  },
  kind: 'privacy' | 'terms'
): boolean {
  const hasPageContent = Boolean(merchant.pages?.[kind]?.trim());
  const templateHasPolicyPage = merchant.template_id === OGABASSEY_TEMPLATE_ID;
  return hasPageContent || templateHasPolicyPage;
}
