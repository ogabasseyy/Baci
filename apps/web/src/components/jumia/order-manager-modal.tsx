'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { JumiaOrderActionControls } from './jumia-order-action-controls';
import {
  type JumiaOrderAction,
  runJumiaOrderAction,
} from './run-jumia-order-action';

function isValidHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface JumiaOrderItem {
  id: string;
  shopId: string;
  status: string;
  product: {
    name: string;
    sellerSku: string;
    imageUrl?: string;
  };
  trackingNumber?: string;
  trackingUrl?: string;
}

interface OrderManagerModalProps {
  orderId: string;
  orderNumber: string;
  integrationId: string;
  isOpen?: boolean;
  onClose: () => void;
  canManage?: boolean;
}

interface FetchItemsCallbacks {
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setItems: (value: JumiaOrderItem[]) => void;
}

async function loadOrderItems(
  orderId: string,
  integrationId: string,
  { setLoading, setError, setItems }: FetchItemsCallbacks,
  signal?: AbortSignal
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(
      `/api/marketplace/jumia/orders/${encodeURIComponent(orderId)}/items?integrationId=${encodeURIComponent(integrationId)}`,
      { signal }
    );
    if (signal?.aborted) return;
    if (!res.ok) throw new Error('Failed to fetch items');
    const data = await res.json();
    if (signal?.aborted) return;
    setItems(data && Array.isArray(data.items) ? data.items : []);
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof DOMException && err.name === 'AbortError') return;
    setError('Could not load order items.');
  } finally {
    if (!signal?.aborted) {
      setLoading(false);
    }
  }
}

export function OrderManagerModal({
  orderId,
  orderNumber,
  integrationId,
  isOpen = true,
  onClose,
  canManage = true,
}: OrderManagerModalProps) {
  const [items, setItems] = useState<JumiaOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelUrls, setLabelUrls] = useState<string[]>([]);
  const [blockedLabelUrl, setBlockedLabelUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchItems = () =>
    loadOrderItems(orderId, integrationId, {
      setLoading,
      setError,
      setItems,
    });

  useEffect(() => {
    if (isOpen && orderId) {
      const controller = new AbortController();
      void loadOrderItems(
        orderId,
        integrationId,
        {
          setLoading,
          setError,
          setItems,
        },
        controller.signal
      );
      return () => controller.abort();
    }
  }, [isOpen, orderId, integrationId]);

  const handleAction = (action: JumiaOrderAction) =>
    runJumiaOrderAction(
      action,
      orderId,
      integrationId,
      items.map((i) => i.id),
      {
        setLabelUrls,
        setBlockedLabelUrl,
        setActionLoading,
        refetch: fetchItems,
        toast,
      }
    );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 relative shrink-0 border border-gray-100 rounded-md overflow-hidden bg-white">
              <Image
                src="/jumia-logo.png"
                alt="Jumia Logo"
                fill
                sizes="40px"
                className="object-contain"
              />
            </div>
            <div>
              <DialogTitle>Manage Jumia Order #{orderNumber}</DialogTitle>
              <DialogDescription>
                Fulfill items, print labels, and manage shipping status.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="size-8 animate-spin text-orange-500" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            {/* Items List */}
            <div className="space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                >
                  <div className="size-12 bg-gray-200 rounded overflow-hidden shrink-0">
                    {item.product.imageUrl && (
                      // biome-ignore lint/performance/noImgElement: External Jumia image
                      <img
                        src={item.product.imageUrl}
                        alt=""
                        className="object-cover w-full h-full"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.product.name}</p>
                    <p className="text-sm text-gray-500">
                      SKU: {item.product.sellerSku}
                    </p>
                    {item.trackingNumber && (
                      <p className="text-xs text-gray-400">
                        Tracking:{' '}
                        {isValidHttpUrl(item.trackingUrl) ? (
                          <a
                            href={item.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-blue-500 hover:text-blue-700"
                          >
                            {item.trackingNumber}
                          </a>
                        ) : (
                          item.trackingNumber
                        )}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={
                      item.status.toLowerCase().includes('shipped')
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>

            <JumiaOrderActionControls
              actionLoading={actionLoading}
              blockedLabelUrl={blockedLabelUrl}
              canManage={canManage}
              handleAction={handleAction}
              labelUrls={labelUrls}
              orderNumber={orderNumber}
            />

            <p className="text-xs text-gray-500 text-center">
              Actions apply to all items in this order. Shipment provider is
              auto-selected during packing.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
