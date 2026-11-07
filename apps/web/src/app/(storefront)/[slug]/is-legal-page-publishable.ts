import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

function hasVisibleText(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim().length > 0
  );
}

export function isLegalPagePublishable(
  merchant: {
    template_id?: string | null;
    pages?: { privacy?: string | null; terms?: string | null } | null;
  },
  kind: 'privacy' | 'terms'
): boolean {
  const hasPageContent = hasVisibleText(merchant.pages?.[kind]);
  const templateHasPolicyPage = merchant.template_id === OGABASSEY_TEMPLATE_ID;
  return hasPageContent || templateHasPolicyPage;
}
