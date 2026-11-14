export function ChatwootInlineCartBridge({
  storeSlug,
}: {
  storeSlug: string;
  widgetOrigin: string;
}) {
  return <output data-testid="bridge-tenant">{storeSlug}</output>;
}
