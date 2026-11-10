import type { CartSnapshot } from '@baci/shared/cart';
import type {
  CartBridgeResult,
  ExperienceErrorCode,
} from '@baci/shared/experience';
import type { AttemptAdmission, AttemptPolicy } from '@/lib/api-attempt-policy';
import type { Product } from '@/lib/products';
import type {
  SendSharedCartCommandInput,
  SharedCartMutationResult,
} from './shared-cart-client';
import type { ReceiptStorage } from './shared-cart-operation-receipts';
import type { SharedCartIntent } from './shared-cart-state';
export interface SharedCartExperienceEntry {
  signature: string;
  generation: number;
  promise: Promise<CartBridgeResult>;
  started?: boolean;
  isSettled(): boolean;
  envelope?: SendSharedCartCommandInput;
  partition?: string;
  prepare(snapshot: CartSnapshot): Promise<boolean>;
  policy: AttemptPolicy<ExperienceErrorCode>;
  canProject(): boolean;
  finish(result: SharedCartMutationResult, expose?: boolean): void;
  deny(): void;
}
export interface SharedCartCommandRuntime {
  enabled(): boolean;
  generation(): number;
  read(): CartSnapshot | null;
  enqueue(operationId: string, intent: SharedCartIntent): void;
  resolveProduct(id: string): Promise<Product | null>;
  admit(): AttemptAdmission<ExperienceErrorCode>;
  loadContinuity(): Promise<string | null>;
  sameShopper?: () => boolean;
  refreshAdmission?: () => Promise<boolean>;
  rebind?: (partition: string) => boolean;
  entries: Map<string, SharedCartExperienceEntry>;
  receiptStorage: ReceiptStorage | null;
}
