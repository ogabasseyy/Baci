import type { Product } from '@/lib/products';
import type { PlannedLegacyImport } from './shared-cart-import';
import type { SharedCartIntent } from './shared-cart-state';

export function buildImportEntries(
  planned: Extract<PlannedLegacyImport, { kind: 'commands' }>,
  cartId: string
): { intent: SharedCartIntent; operationId: string }[] {
  if (planned.replacement)
    return [
      {
        operationId: planned.replacement.operationId,
        intent: {
          kind: 'replace',
          lines: planned.replacement.lines,
          expectedVersion: planned.replacement.expectedVersion,
        },
      },
    ];
  return [
    ...planned.adds.map((add) => ({
      intent: {
        input: add.line,
        kind: 'add' as const,
        product: {} as Product,
        quantity: add.line.quantity,
        tempId: `imp-${add.operationId.slice(-8)}`,
      },
      operationId: add.operationId,
    })),
    ...planned.sets.map((set, index) => ({
      intent: {
        kind: 'set_quantity' as const,
        quantity: set.quantity,
        target: { kind: 'lineId' as const, lineId: set.lineId },
      },
      operationId: `import:${cartId}:set:${set.lineId}:${index}`,
    })),
    ...planned.assurances.map((set) => ({
      intent: {
        kind: 'set_assurance' as const,
        hasAssurance: set.hasAssurance,
        target: { kind: 'lineId' as const, lineId: set.lineId },
      },
      operationId: `import:${cartId}:assurance:${set.lineId}:${set.hasAssurance}`,
    })),
  ];
}
