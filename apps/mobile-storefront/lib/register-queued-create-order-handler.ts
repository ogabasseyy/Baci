import { offlineQueue } from '@/lib/offline-queue';
import { replayQueuedCreateOrder } from '@/lib/replay-queued-create-order';
import { createOrder } from '@/services/orders';
import { useAuthStore } from '@/stores/auth-store';

export function registerQueuedCreateOrderHandler(): void {
  offlineQueue.registerHandler('create_order', (orderData) =>
    replayQueuedCreateOrder(
      createOrder,
      orderData,
      useAuthStore.getState().user?.id
    )
  );
  let previousUserId = useAuthStore.getState().user?.id;
  useAuthStore.subscribe((state) => {
    const currentId = state.user?.id;
    if (currentId && currentId !== previousUserId) {
      offlineQueue.processPending();
    }
    previousUserId = currentId;
  });
}
