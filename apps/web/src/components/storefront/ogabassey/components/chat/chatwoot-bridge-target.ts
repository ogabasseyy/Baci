export function isCurrentChatwootBridgeTarget(input: {
  active: boolean;
  frame: HTMLIFrameElement;
  target: Window;
  storeSlug: string;
  conversationId: number;
  activeConversationId: number | null;
  activeContextRequestId: string | null;
  cartState: {
    isHydrated: boolean;
    merchantSlug: string | null;
    sharedCartEnabled: boolean;
  };
}): boolean {
  const currentFrame = document.getElementById('chatwoot_live_chat_widget');
  const holder = document.getElementById('cw-widget-holder');
  return Boolean(
    input.active &&
      currentFrame === input.frame &&
      input.frame.isConnected &&
      holder?.contains(input.frame) &&
      input.frame.contentWindow === input.target &&
      input.activeConversationId === input.conversationId &&
      input.activeContextRequestId !== null &&
      input.cartState.isHydrated &&
      input.cartState.merchantSlug === input.storeSlug &&
      input.cartState.sharedCartEnabled === true
  );
}
