import type { JumiaProductPreflightResponse } from '@/schemas/jumia/product-preflight';

type Props = {
  result: JumiaProductPreflightResponse;
  selectedCount: number;
  checkedCount: number;
};

export function JumiaProductPreflightResultSummary({
  result,
  selectedCount,
  checkedCount,
}: Props) {
  return (
    <div className="grid gap-2" role="status" aria-live="polite">
      <p className="text-sm">
        Checked {checkedCount} of {selectedCount} selected draft products.
        Digest: <code>{result.digest}</code>
      </p>
      {result.products.map((product) => {
        const blockerOccurrences = new Map<string, number>();
        return (
          <div key={product.productId} className="rounded bg-muted/40 p-2">
            <p className="text-sm font-medium">Product {product.productId}</p>
            {product.blockers.length ? (
              <ul className="list-disc pl-5 text-xs text-amber-800">
                {product.blockers.map((blocker) => {
                  const occurrence = blockerOccurrences.get(blocker) ?? 0;
                  blockerOccurrences.set(blocker, occurrence + 1);
                  return <li key={`${blocker}:${occurrence}`}>{blocker}</li>;
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No local blockers found. External evidence remains required.
              </p>
            )}
          </div>
        );
      })}
      <p className="text-sm font-medium">canSubmit: false</p>
    </div>
  );
}
