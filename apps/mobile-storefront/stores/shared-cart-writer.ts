import type { CartItem } from './cart-store.types';

export type SharedCartWrite =
  | { type: 'add'; item: Omit<CartItem, 'id'> }
  | { type: 'remove'; id: string }
  | { type: 'quantity'; id: string; quantity: number }
  | { type: 'clear' }
  | { type: 'negotiate'; id: string; price: number }
  | { type: 'negotiate_group'; total: number }
  | { type: 'clear_negotiation'; id: string }
  | { type: 'assurance'; id: string }
  | { type: 'legacy_restore' | 'legacy_reprice' | 'legacy_generation' };
interface Owner {
  write(action: SharedCartWrite): Promise<void>;
  onError(): void;
  retire?(): Promise<void>;
}
let owner: Owner | null = null;
let generation = 0;
let writeRevision = 0;
/** Changes at intent time, before controller serialization can defer an edit. */
export const sharedCartWriteRevision = () => writeRevision;
/** Direct controller intents (merge, account, pairing choices) fence checkout too. */
export function markSharedCartIntent(): void {
  writeRevision += 1;
}
let suspended = false;
const listeners = new Set<() => void>();
function notifyWriterPresence(): void {
  for (const listener of [...listeners]) listener();
}
export function subscribeSharedCartWriter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const retirements = new WeakMap<Owner, Promise<boolean>>();
export function sharedCartWriterGeneration(): number {
  return generation;
}
/** Invalidate synchronously before awaiting Auth or network teardown. */
export function retireSharedCartWriter(): Promise<boolean> {
  if (!owner) return Promise.resolve(false);
  const current = owner;
  const pending = retirements.get(current);
  if (pending) return pending;
  generation += 1;
  suspended = true;
  const retirement = Promise.resolve()
    .then(async () => {
      await current.retire?.();
      return true;
    })
    .finally(() => {
      retirements.delete(current);
    });
  retirements.set(current, retirement);
  return retirement;
}
/** Store-level fencing covers direct callers as well as the useCart hook. */
export function installSharedCartWriter(next: Owner): () => void {
  generation += 1;
  owner = next;
  suspended = false;
  notifyWriterPresence();
  return () => {
    if (owner === next) {
      owner = null;
      notifyWriterPresence();
    }
  };
}
export function hasSharedCartWriter(): boolean {
  return owner !== null;
}
export function forwardSharedCartWrite(
  action: SharedCartWrite
): Promise<void> | null {
  const current = owner;
  if (!current) return null;
  if (!action.type.startsWith('legacy_')) writeRevision += 1;
  const pending = Promise.resolve().then(() => {
    if (current !== owner || suspended) throw new Error('Cart session changed');
    return current.write(action);
  });
  // Some legacy store actions return void. Always observe the rejection there too.
  void pending.catch(() => {
    if (current === owner) current.onError();
  });
  return pending;
}
