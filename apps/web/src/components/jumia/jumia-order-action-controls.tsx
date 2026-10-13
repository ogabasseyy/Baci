import { AlertCircle, Loader2, Package, Printer, Truck, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { JumiaOrderAction } from './run-jumia-order-action';

export function JumiaOrderActionControls({
  actionLoading,
  blockedLabelUrl,
  canManage = true,
  handleAction,
  labelUrls,
  orderNumber,
}: {
  actionLoading: string | null;
  blockedLabelUrl: string | null;
  canManage?: boolean;
  handleAction: (action: JumiaOrderAction) => void;
  labelUrls: string[];
  orderNumber: string;
}) {
  return (
    <>
      {canManage ? (
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          <Button
            onClick={() => handleAction('pack')}
            disabled={!!actionLoading}
            variant="secondary"
          >
            {actionLoading === 'pack' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Package className="mr-2 size-4" />
            )}
            Pack All
          </Button>

          <Button
            className="bg-orange-600 hover:bg-orange-700 text-white"
            onClick={() => handleAction('ready_to_ship')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'ready_to_ship' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Truck className="mr-2 size-4" />
            )}
            Ready to Ship
          </Button>

          <Button
            onClick={() => handleAction('print_label')}
            disabled={!!actionLoading}
            variant="outline"
          >
            {actionLoading === 'print_label' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Printer className="mr-2 size-4" />
            )}
            Print Label
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!!actionLoading} variant="destructive">
                {actionLoading === 'cancel' ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <X className="mr-2 size-4" />
                )}
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Cancel all items in this order?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. All items in order #
                  {orderNumber} will be cancelled on Jumia.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Go Back</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleAction('cancel')}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, Cancel Order
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <p className="text-xs text-gray-500 text-center pt-4 border-t">
          View only. Ask an integrations manager to pack, ship, print, or cancel
          this order.
        </p>
      )}

      {blockedLabelUrl && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Popup Blocked</AlertTitle>
          <AlertDescription>
            Your browser blocked the label popup.{' '}
            <a
              href={blockedLabelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline text-blue-600 hover:text-blue-800"
            >
              Click here to open the label
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

      {labelUrls.length > 0 && (
        <div className="space-y-1 pt-2 border-t">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Shipping Labels:
          </p>
          <ul className="space-y-1">
            {labelUrls.map((url, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: index needed to handle duplicate label URLs
              <li key={`${url}-${index}`}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 underline break-all"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
