'use client';

import {
  CheckCircle,
  ChevronLeft,
  Copy,
  Edit,
  Mail,
  MoreVertical,
  Package,
  PackageCheck,
  Phone,
  Send,
  Share2,
  Truck,
  Undo2,
  XCircle,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { apiPatch, apiPost, fetchWithCsrf } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import {
  type Order,
  resendOrderConfirmation,
  type ShippingStatus,
} from '../actions';
import { getOrderItems, type OrderDetailsItem } from '../order-items';
import { getOrderSourceLabel } from '../order-source-display';
import { OrderSourceIcon } from '../order-source-icon';
import { StatusBadge } from '../status-badge';
import ConfirmInsuranceDialog, {
  type ConfirmOrderPayload,
} from './confirm-insurance-dialog';
import { summarizeInsuranceConfirmation } from './insurance-confirmation-summary';
import { OrderPaymentSummary } from './OrderPaymentSummary';
import { ShipmentDetailsCard } from './shipment-details-card';

// Type definitions
interface OrderDetailsClientPageProps {
  initialOrder: Order;
}
// Helper function
function formatCurrency(amount: number, currency?: string | null): string {
  return formatDisplayCurrency(amount, currency || 'NGN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function toDbShippingStatus(status: ShippingStatus): string {
  return status.toLowerCase().replace('canceled', 'cancelled');
}

function fromDbShippingStatus(status: string): ShippingStatus {
  return status
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') as ShippingStatus;
}

interface ConfirmOrderResponse {
  error?: string;
  insuranceError?: string;
  insurance?: {
    success?: boolean;
    results?: Array<{
      success?: boolean;
      policyNumber?: string;
      error?: string;
      itemId?: string;
    }>;
  };
}

async function confirmOrderRequest(
  orderId: string,
  data: ConfirmOrderPayload
): Promise<ConfirmOrderResponse> {
  const response = await fetchWithCsrf(`/api/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const result: ConfirmOrderResponse = await response.json();

  if (!response.ok) throw new Error(result.error || 'Confirmation failed');

  return result;
}

// Placeholder FulfillmentDialog - replace with actual import when available
function FulfillmentDialog({
  isOpen,
}: {
  isOpen: boolean;
  onClose: () => void;
  orderItems: OrderDetailsItem[];
  onConfirm: (data: unknown) => void;
}) {
  if (!isOpen) return null;
  return null; // Placeholder - actual dialog should be imported
}

export default function OrderDetailsClientPage({
  initialOrder,
}: OrderDetailsClientPageProps) {
  const { toast } = useToast();
  const [order, setOrder] = useState<Order>(initialOrder);
  const [isFulfillmentDialogOpen, setIsFulfillmentDialogOpen] = useState(false);
  const [isConfirmationDialogOpen, setIsConfirmationDialogOpen] =
    useState(false);

  if (!order) {
    return null;
  }

  const displayItems = getOrderItems(order);
  const orderCurrency = order.currency || 'NGN';

  const doesOrderRequireFulfillment = () => {
    // Check for fulfillment fields OR assurance
    // Assurance items implicitly require fulfillment (device details)
    return displayItems.some(
      (item) =>
        (item.product?.fulfillmentFields &&
          item.product.fulfillmentFields.length > 0) ||
        item.hasAssurance // New check
    );
  };

  const handleUpdateStatus = async (newStatus: ShippingStatus) => {
    // If confirming ('Processing'), check if we need the new dialog
    if (newStatus === 'Processing' && order.shippingStatus === 'Pending') {
      setIsConfirmationDialogOpen(true);
      return;
    }

    if (newStatus === 'Canceled') {
      const warning =
        order.paymentStatus === 'Paid'
          ? 'This is a paid order. Cancelling records your account as the actor and starts the refund workflow. Continue?'
          : 'Cancel this order and restore its tracked inventory?';
      if (!window.confirm(warning)) return;
    }

    try {
      let result: {
        order: {
          shipping_status: string;
          shipping_provider?: string | null;
          tracking_number?: string | null;
        };
      };
      if (newStatus === 'Canceled') {
        await apiPost<{ success: boolean }>(
          `/api/orders/${order.id}/cancelled`,
          { cancelled_by: 'merchant', confirm_cancellation: true }
        );
        result = { order: { shipping_status: 'cancelled' } };
      } else {
        result = await apiPatch<{
          order: {
            shipping_status: string;
            shipping_provider?: string | null;
            tracking_number?: string | null;
          };
        }>(`/api/orders/${order.id}`, {
          shipping_status: toDbShippingStatus(newStatus),
        });
      }

      setOrder((prev) => ({
        ...prev,
        shippingStatus: fromDbShippingStatus(result.order.shipping_status),
        shipping_provider:
          result.order.shipping_provider ?? prev.shipping_provider,
        tracking_number: result.order.tracking_number ?? prev.tracking_number,
      }));
      toast({
        title: `Order status updated to ${newStatus}`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to update order status',
      });
    }
  };

  const handleConfirmationSubmit = async (data: ConfirmOrderPayload) => {
    try {
      const result = await confirmOrderRequest(order.id, data);

      // Surface item-level failures (incl. partial: one policy created + other
      // paid items not insured) instead of masking them with the first policy.
      toast(summarizeInsuranceConfirmation(result));

      // Update local state
      setOrder((prev) => ({
        ...prev,
        shippingStatus: 'Processing',
        paymentStatus: 'Paid',
      }));
      setIsConfirmationDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'An error occurred',
      });
    }
  };

  const handleResendNotification = async () => {
    try {
      toast({ title: 'Sending email...', description: 'Please wait.' });
      const result = await resendOrderConfirmation(order.id);

      if (result.success) {
        toast({ title: 'Email Sent', description: result.message });
      } else {
        toast({
          variant: 'destructive',
          title: 'Failed',
          description: result.message,
        });
      }
    } catch (_error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to send email.',
      });
    }
  };

  // Legacy mock handler - kept for backward compat if needed
  const handleFulfillmentConfirm = async (_fulfillmentData: unknown) => {
    // Placeholder for fulfillment confirmation logic
  };

  // ... formatCurrency ...

  const getPrimaryAction = () => {
    switch (order.shippingStatus) {
      case 'Pending':
        return {
          text: 'Confirm Order',
          action: () => setIsConfirmationDialogOpen(true), // Always open dialog for consistency
          icon: CheckCircle,
        };
      // ... rest of cases
      case 'Processing':
        return {
          text: 'Ship Order',
          action: () => handleUpdateStatus('Shipped'),
          icon: Truck,
        };
      case 'Shipped':
        return {
          text: 'Mark as Delivered',
          action: () => handleUpdateStatus('Delivered'),
          icon: PackageCheck,
        };
      default:
        return null;
    }
  };

  const getSecondaryAction = () => {
    switch (order.shippingStatus) {
      case 'Pending':
      case 'Processing':
        return {
          text: 'Cancel Order',
          action: () => handleUpdateStatus('Canceled'),
          icon: XCircle,
          variant: 'destructive' as const,
        };
      case 'Delivered':
        return {
          text: 'Process Refund',
          action: () => handleUpdateStatus('Returned' as ShippingStatus),
          icon: Undo2,
          variant: 'outline' as const,
        };
      default:
        return null;
    }
  };

  const primaryAction = getPrimaryAction();
  const secondaryAction = getSecondaryAction();

  return (
    <>
      <ConfirmInsuranceDialog
        isOpen={isConfirmationDialogOpen}
        onClose={() => setIsConfirmationDialogOpen(false)}
        onConfirm={handleConfirmationSubmit}
        orderItems={displayItems}
      />
      <FulfillmentDialog
        isOpen={isFulfillmentDialogOpen}
        onClose={() => setIsFulfillmentDialogOpen(false)}
        orderItems={displayItems}
        // ...
        onConfirm={handleFulfillmentConfirm}
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/orders">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
            >
              <ChevronLeft className="size-4" />
              <span className="sr-only">Back to Orders</span>
            </Button>
          </Link>
          <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
            Order {order.orderNumber}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1">
              <Share2 className="size-3.5" />
              <span>Share</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-9">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => handleResendNotification()}>
                  <Send className="mr-2 size-4" /> Resend Email
                </DropdownMenuItem>
                <DropdownMenuItem>Print Invoice</DropdownMenuItem>
                <DropdownMenuItem>Contact Customer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid auto-rows-max items-start gap-4 md:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>Order Details</CardTitle>
                    <CardDescription>Date: {order.date}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={order.paymentStatus} type="payment" />
                    <StatusBadge
                      status={order.shippingStatus}
                      type="shipping"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Channel
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <OrderSourceIcon source={order.source} />
                      <p className="font-semibold">
                        {getOrderSourceLabel(order.source)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Customer
                    </p>
                    <p className="font-semibold">{order.customerName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Billing Address
                    </p>
                    <p className="text-sm">
                      Oko-awo Street (Building 5), VI opposite Eko hotel,
                      Nigeria
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Contact Details
                    </p>
                    {order.customer_phone && (
                      <div className="flex items-center gap-2 text-sm mt-1">
                        <Phone className="size-4 text-muted-foreground" />
                        <span>{order.customer_phone}</span>
                      </div>
                    )}
                    {order.customer_email && (
                      <div className="flex items-center gap-2 text-sm mt-1">
                        <Mail className="size-4 text-muted-foreground" />
                        <span>{order.customer_email}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Products</CardTitle>
                {doesOrderRequireFulfillment() && (
                  <Alert
                    variant="default"
                    className="mt-2 bg-blue-50 border-blue-200 text-blue-800"
                  >
                    <Package className="size-4 text-blue-800!" />
                    <AlertTitle>Fulfillment Details Required</AlertTitle>
                    <AlertDescription>
                      One or more items in this order need specific details
                      (e.g., serial numbers) before fulfillment.
                    </AlertDescription>
                  </Alert>
                )}
              </CardHeader>
              <CardContent>
                {displayItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 mb-4 last:mb-0"
                  >
                    <Image
                      src={
                        item.image || item.product?.image || '/placeholder.png'
                      }
                      alt={item.name || 'Product'}
                      width={64}
                      height={64}
                      className="rounded-md object-cover"
                    />
                    <div className="flex-1">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.quantity} x{' '}
                        {formatCurrency(item.price, orderCurrency)}
                      </p>
                    </div>
                    <p className="font-semibold">
                      {formatCurrency(
                        item.price * item.quantity,
                        orderCurrency
                      )}
                    </p>
                  </div>
                ))}
              </CardContent>
              <CardFooter className="flex gap-2 justify-end">
                {secondaryAction && (
                  <Button
                    variant={secondaryAction.variant}
                    onClick={secondaryAction.action}
                    className="gap-1"
                  >
                    <secondaryAction.icon className="size-4" />
                    {secondaryAction.text}
                  </Button>
                )}
                {primaryAction && (
                  <Button onClick={primaryAction.action} className="gap-1">
                    <primaryAction.icon className="size-4" />
                    {primaryAction.text}
                  </Button>
                )}
              </CardFooter>
            </Card>
            <ShipmentDetailsCard order={order} />
          </div>

          <div className="grid auto-rows-max items-start gap-4">
            <OrderPaymentSummary order={order} />

            <Card>
              <CardHeader>
                <CardTitle>Payment Status</CardTitle>
              </CardHeader>
              <CardContent>
                <StatusBadge status={order.paymentStatus} type="payment" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
              </CardHeader>
              <CardContent>
                {order.transactions && order.transactions.length > 0 ? (
                  <div className="space-y-4">
                    {order.transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0"
                      >
                        <div>
                          <p className="font-medium capitalize">
                            {tx.gateway}
                            <span
                              className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                                tx.status === 'completed' ||
                                tx.status === 'success'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}
                            >
                              {tx.status}
                            </span>
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                          <p className="text-muted-foreground text-xs font-mono mt-0.5">
                            {tx.reference}
                          </p>
                        </div>
                        <div className="font-semibold">
                          {formatCurrency(
                            tx.amount,
                            tx.currency || orderCurrency
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No transactions found.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Shipping</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <p className="font-semibold">{order.customerName}</p>
                  <p className="text-sm text-muted-foreground">09035576078</p>
                  <p className="text-sm text-muted-foreground">
                    Oko-awo Street (Building 5), VI opposite Eko hotel, Nigeria
                  </p>
                </div>
                <div className="flex gap-1 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs h-7"
                  >
                    <Edit className="size-3" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs h-7"
                  >
                    <Copy className="size-3" /> Copy
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
