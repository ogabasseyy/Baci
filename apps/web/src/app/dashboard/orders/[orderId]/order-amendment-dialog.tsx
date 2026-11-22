'use client';

import { formatOrderItemDisplayName } from '@baci/shared/lib';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { OrderAmendmentEvidenceSelect } from './order-amendment-evidence-select';
import {
  type AmendmentDialogProps,
  useOrderAmendmentDialog,
} from './use-order-amendment-dialog';

const selectStyle = 'h-10 rounded-md border bg-background px-3 text-sm';

export function OrderAmendmentDialog(props: AmendmentDialogProps) {
  const { items, canRefund, onClose } = props;
  const {
    lineId,
    setLineId,
    search,
    setSearch,
    options,
    setOptions,
    selected,
    setSelected,
    preview,
    setPreview,
    reason,
    setReason,
    customerAgreed,
    setCustomerAgreed,
    bankEvidenceId,
    setBankEvidenceId,
    requiresBankEvidence,
    pending,
    uncertain,
    error,
    findReplacements,
    fetchPreview,
    checkConfirmation,
    confirm,
    run,
    money,
  } = useOrderAmendmentDialog(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !uncertain) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change items</DialogTitle>
          <DialogDescription>
            Choose one item and review the updated total with the customer.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={pending || uncertain} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="amendment-line">Item to replace</Label>
            <select
              id="amendment-line"
              className={selectStyle}
              value={lineId}
              onChange={(event) => {
                setLineId(event.target.value);
                setPreview(null);
                setOptions([]);
                setSelected('');
              }}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatOrderItemDisplayName({
                    baseName: item.name,
                    variantName: item.variant,
                  })}{' '}
                  × {item.quantity}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="amendment-search">Find a replacement</Label>
            <div className="flex gap-2">
              <Input
                id="amendment-search"
                value={search}
                maxLength={80}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && search.trim().length >= 2) {
                    event.preventDefault();
                    void findReplacements();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={findReplacements}
                disabled={!lineId || search.trim().length < 2}
              >
                Search
              </Button>
            </div>
          </div>
          {options.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="amendment-replacement">Replacement</Label>
              <select
                id="amendment-replacement"
                className={selectStyle}
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setPreview(null);
                  setCustomerAgreed(false);
                }}
              >
                <option value="">Select a replacement</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                disabled={!selected}
                onClick={fetchPreview}
              >
                Preview change
              </Button>
            </div>
          )}
          {preview && (
            <>
              <dl className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Original</dt>
                  <dd>
                    {formatOrderItemDisplayName({
                      baseName: preview.beforeLine.name,
                      variantName: preview.beforeLine.variantName,
                      condition: preview.beforeLine.condition,
                    })}{' '}
                    × {preview.beforeLine.quantity}
                  </dd>
                  <dd className="font-medium">
                    {money(preview.beforeTotalMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Revised</dt>
                  <dd>
                    {formatOrderItemDisplayName({
                      baseName: preview.afterLine.name,
                      variantName: preview.afterLine.variantName,
                      condition: preview.afterLine.condition,
                    })}{' '}
                    × {preview.afterLine.quantity}
                  </dd>
                  <dd className="font-medium">
                    {money(preview.afterTotalMinor)}
                  </dd>
                </div>
              </dl>
              <p className="text-sm">
                {requiresBankEvidence
                  ? `Select the verified payment of ${money(preview.adjustmentMinor)} to confirm.`
                  : preview.adjustmentMinor > 0
                    ? `Balance due ${money(preview.adjustmentMinor)}. Fulfillment will be held.`
                    : preview.adjustmentMinor < 0
                      ? `Refund owed ${money(-preview.adjustmentMinor)}. Fulfillment will be held.`
                      : 'The order total is unchanged.'}
              </p>
              {requiresBankEvidence && (
                <OrderAmendmentEvidenceSelect
                  entries={preview.bankEvidence}
                  value={bankEvidenceId}
                  onChange={setBankEvidenceId}
                  money={money}
                />
              )}
              {preview.adjustmentMinor < 0 && !canRefund && (
                <p role="status" className="text-sm">
                  A staff member with refund permission must confirm this
                  change.
                </p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="amendment-reason">Reason</Label>
                <Textarea
                  id="amendment-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={customerAgreed}
                  onChange={(event) => setCustomerAgreed(event.target.checked)}
                />
                The customer agreed to the replacement and revised amount.
              </label>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          {uncertain ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(checkConfirmation)}
              >
                Check status
              </Button>
              <Button type="button" disabled={pending} onClick={confirm}>
                Retry same confirmation
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onClose}
              >
                Close
              </Button>
              {preview && (
                <Button
                  type="button"
                  disabled={
                    pending ||
                    !customerAgreed ||
                    !reason.trim() ||
                    (requiresBankEvidence && !bankEvidenceId) ||
                    (preview.adjustmentMinor < 0 && !canRefund)
                  }
                  onClick={confirm}
                >
                  {pending ? 'Working…' : 'Confirm change'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
