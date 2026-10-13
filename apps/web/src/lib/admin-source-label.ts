const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  mobile_app: 'Mobile App',
  online_store: 'Online Store',
  physical: 'Physical Store',
  storefront: 'Storefront',
  unknown: 'Unknown',
  whatsapp: 'WhatsApp',
};

export function formatAdminSourceLabel(source: string): string {
  return (
    SOURCE_LABELS[source] ??
    source
      .split(/[_-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')
  );
}
