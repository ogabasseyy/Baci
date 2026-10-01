'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiDelete } from '@/lib/api-client';
import { adminNotificationDetailRpcSchema } from '@/schemas/notifications';
import type { NotificationWithStats } from '@/types/notifications';
import type { NotificationDeliveryRecord } from '../components/notification-delivery-record';
import { NotificationDetail } from '../components/notification-detail';
import { NotificationDetailsLoadingState } from '../components/notification-details-loading-state';
import { NotificationDetailsNotFoundState } from '../components/notification-details-not-found-state';

async function fetchNotificationDetails(
  id: string,
  signal: AbortSignal
): Promise<{
  notification: NotificationWithStats;
  deliveries: NotificationDeliveryRecord[];
} | null> {
  const response = await fetch(`/api/admin/notifications/${id}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Failed to fetch notification');
  const data: unknown = await response.json();
  const responseData =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const parsed = adminNotificationDetailRpcSchema.safeParse({
    deliveries: responseData.deliveries,
    notification: responseData,
    stats: responseData.stats,
  });
  if (!parsed.success) throw new Error('Invalid notification detail response');

  return {
    notification: {
      ...parsed.data.notification,
      stats: parsed.data.stats,
      target_merchant_ids: parsed.data.notification.target_merchant_ids ?? [],
    },
    deliveries: parsed.data.deliveries,
  };
}

export default function NotificationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [notification, setNotification] =
    useState<NotificationWithStats | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryRecord[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey explicitly triggers a retry.
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setIsNotFound(false);
    setLoadError(null);
    fetchNotificationDetails(id, controller.signal)
      .then((result) => {
        if (result) {
          setNotification(result.notification);
          setDeliveries(result.deliveries);
          setLoadError(null);
        } else {
          setIsNotFound(true);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          console.error('Error fetching notification:', error);
          setLoadError('Notification details could not be loaded.');
          toast({
            title: 'Error',
            description: 'Failed to fetch notification details',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [id, refreshKey, toast]);
  const handleDelete = async () => {
    setIsDeleting(true);
    setShowDeleteDialog(false);
    try {
      await apiDelete(`/api/admin/notifications/${id}`);
      toast({
        title: 'Cancelled',
        description: 'Pending notification has been cancelled',
      });
      router.push('/admin/notifications');
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel pending notification',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };
  const retryLoad = () => {
    setIsLoading(true);
    setIsNotFound(false);
    setLoadError(null);
    setRefreshKey((key) => key + 1);
  };
  if (isLoading) return <NotificationDetailsLoadingState />;
  if (loadError) return <NotificationDetailsLoadError onRetry={retryLoad} />;
  if (isNotFound || !notification) return <NotificationDetailsNotFoundState />;
  return (
    <>
      <NotificationDetail
        deliveries={deliveries}
        isDeleting={isDeleting}
        notification={notification}
        onDelete={() => setShowDeleteDialog(true)}
      />
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel pending notification?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes queued work before delivery begins. Delivery history
              cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Cancel Notification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NotificationDetailsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      role="alert"
    >
      <p className="font-medium">Notification details could not load.</p>
      <p>Check your connection and try again.</p>
      <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </div>
  );
}
