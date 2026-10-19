import type { piggyvestPurchaseSchemas } from '../contracts/piggyvest-purchase';
export type PurchaseCommand = ReturnType<
  typeof piggyvestPurchaseSchemas.confirmation.parse
>;
export type PurchasePublished = ReturnType<
  typeof piggyvestPurchaseSchemas.published.parse
>;
export type PurchaseReceipt = ReturnType<
  typeof piggyvestPurchaseSchemas.receipt.parse
>;
export type PurchaseRecovery = ReturnType<
  typeof piggyvestPurchaseSchemas.status.parse
>;
export type PurchaseView = {
  sessionKey: string;
  goalId: string;
  operationId: string;
} & (
  | { status: 'selection' | 'loading_quote' | 'unavailable' }
  | { status: 'review'; quote: PurchasePublished; command: PurchaseCommand }
  | {
      status: 'pending' | 'uncertain' | 'prepared';
      recovering: boolean;
      receipt: PurchaseReceipt | null;
      recovery: PurchaseRecovery | null;
    }
);
