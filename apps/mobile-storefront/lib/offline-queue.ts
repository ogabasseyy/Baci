import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { DeferredOfflineMutationError } from './deferred-offline-mutation-error';
import { createLogger } from './logger';
import type {
  MutationType,
  OfflineQueueState,
  QueuedMutation,
} from './offline-queue.types';
import {
  readPersistedOfflineQueueState,
  writePersistedOfflineQueueState,
} from './offline-queue-storage';

const log = createLogger('OfflineQueue');

export type { MutationType, OfflineQueueState, QueuedMutation };

type MutationHandler = (payload: unknown) => Promise<unknown>;
class OfflineQueueManager {
  private state: OfflineQueueState = {
    queue: [],
    isProcessing: false,
    lastSyncAt: null,
  };

  private handlers: Map<MutationType, MutationHandler> = new Map();
  private listeners: Set<(state: OfflineQueueState) => void> = new Set();
  private unsubscribeNetInfo: (() => void) | null = null;
  // BUG-4-002 FIX: Prevent duplicate initialization with promise deduplication
  private initPromise: Promise<void> | null = null;
  private failedMutations: QueuedMutation[] = [];
  private errorCallback: ((mutation: QueuedMutation) => void) | null = null;

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();

    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private async _doInitialize(): Promise<void> {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }

    await this.loadQueue();

    this.unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const isOnline =
        state.isConnected === true && state.isInternetReachable !== false;

      if (isOnline && this.state.queue.length > 0 && !this.state.isProcessing) {
        this.processQueue();
      }
    });

    const netState = await NetInfo.fetch();
    const isOnline =
      netState.isConnected === true && netState.isInternetReachable !== false;

    if (isOnline && this.state.queue.length > 0) {
      this.processQueue();
    }
  }

  destroy(): void {
    this.unsubscribeNetInfo?.();
    this.listeners.clear();
    this.initPromise = null;
  }

  setErrorCallback(callback: (mutation: QueuedMutation) => void): void {
    this.errorCallback = callback;
  }

  getFailedMutations(): QueuedMutation[] {
    return [...this.failedMutations];
  }

  clearFailedMutations(): void {
    this.failedMutations = [];
  }

  registerHandler(type: MutationType, handler: MutationHandler): void {
    this.handlers.set(type, handler);
  }

  processPending(): void {
    void this.processQueue();
  }

  async enqueue<T>(type: MutationType, payload: T): Promise<string> {
    const id = `${type}_${Date.now()}_${Crypto.randomUUID().replace(/-/g, '').substring(0, 9)}`;

    const mutation: QueuedMutation = {
      id,
      type,
      payload: JSON.stringify(payload),
      queuedAt: Date.now(),
      retryCount: 0,
    };

    this.state.queue.push(mutation);
    await this.persistQueue();
    this.notifyListeners();

    log.info(`Queued mutation: ${type} (${id})`);

    const netState = await NetInfo.fetch();
    const isOnline =
      netState.isConnected === true && netState.isInternetReachable !== false;

    if (isOnline && !this.state.isProcessing) {
      this.processQueue();
    }

    return id;
  }

  async remove(id: string): Promise<void> {
    this.state.queue = this.state.queue.filter((m) => m.id !== id);
    await this.persistQueue();
    this.notifyListeners();
  }

  getState(): OfflineQueueState {
    return { ...this.state };
  }

  getPendingCount(type?: MutationType): number {
    if (type) {
      return this.state.queue.filter((m) => m.type === type).length;
    }
    return this.state.queue.length;
  }

  subscribe(listener: (state: OfflineQueueState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async processQueue(): Promise<void> {
    if (this.state.isProcessing || this.state.queue.length === 0) {
      return;
    }

    this.state.isProcessing = true;
    this.notifyListeners();

    log.info(`Processing ${this.state.queue.length} queued mutations`);

    const deferredThisPass = new Set<string>();

    // Process mutations in order (FIFO), draining the live queue
    // so items enqueued mid-flight are picked up in the same pass
    while (this.state.queue.length > 0) {
      const mutation = this.state.queue[0];
      const handler = this.handlers.get(mutation.type);

      if (!handler) {
        log.warn(`No handler for mutation type: ${mutation.type}`);
        await this.remove(mutation.id);
        continue;
      }

      try {
        const payload = JSON.parse(mutation.payload);
        await handler(payload);

        await this.remove(mutation.id);
        log.info(`Successfully processed: ${mutation.id}`);
      } catch (error) {
        if (error instanceof DeferredOfflineMutationError) {
          log.info(
            `Deferring ${mutation.id} until the originating account returns`
          );
          if (deferredThisPass.has(mutation.id)) {
            break;
          }
          deferredThisPass.add(mutation.id);
          const deferred = this.state.queue.shift();
          if (deferred) {
            this.state.queue.push(deferred);
          }
          await this.persistQueue();
          continue;
        }

        mutation.retryCount++;
        mutation.lastError =
          error instanceof Error ? error.message : 'Unknown error';

        log.error(`Failed to process ${mutation.id}:`, error);

        if (mutation.retryCount >= 5) {
          log.warn(
            `Max retries exceeded for ${mutation.id}, moving to failed list`
          );

          this.failedMutations.push({ ...mutation });

          if (this.errorCallback) {
            this.errorCallback({ ...mutation });
          }

          await this.remove(mutation.id);
        } else {
          await this.persistQueue();
        }

        const netState = await NetInfo.fetch();
        const isOnline =
          netState.isConnected === true &&
          netState.isInternetReachable !== false;

        if (!isOnline) {
          log.info('Network lost during processing, stopping');
          break;
        }

        const delay = Math.min(1000 * 2 ** mutation.retryCount, 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.state.isProcessing = false;
    this.state.lastSyncAt = Date.now();
    await this.persistQueue();
    this.notifyListeners();
  }

  private async loadQueue(): Promise<void> {
    try {
      const persistedState = await readPersistedOfflineQueueState();
      this.state.queue = persistedState.queue;
      this.state.lastSyncAt = persistedState.lastSyncAt;
    } catch (error) {
      log.warn('Failed to load queue:', error);
    }
  }

  private async persistQueue(): Promise<void> {
    try {
      await writePersistedOfflineQueueState({
        lastSyncAt: this.state.lastSyncAt,
        queue: this.state.queue,
      });
    } catch (error) {
      log.warn('Failed to persist queue:', error);
    }
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      listener(state);
    });
  }
}

export const offlineQueue = new OfflineQueueManager();
