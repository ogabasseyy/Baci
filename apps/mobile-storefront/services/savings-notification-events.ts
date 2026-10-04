type NotificationScope = { merchantId: string; userId: string };
const listeners = new Set<(scope: NotificationScope) => void>();

export const savingsNotificationEvents = {
  subscribe(scope: NotificationScope, refresh: () => void): () => void {
    const listener = (incoming: NotificationScope) => {
      if (
        incoming.merchantId === scope.merchantId &&
        incoming.userId === scope.userId
      )
        refresh();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  publish(scope: NotificationScope): void {
    for (const listener of listeners) listener(scope);
  },
};
