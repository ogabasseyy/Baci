'use client';

import {
  AlertTriangle,
  BarChart3,
  Bell,
  Clock,
  Loader2,
  Plus,
  Send,
  TimerReset,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  AdminNotificationFilters,
  NotificationWithStats,
} from '@/types/notifications';
import { NotificationListFilters } from './notification-list-filters';
import { NotificationListTable } from './notification-list-table';

export interface AdminNotificationDashboardStats {
  totalSent: number;
  avgReadRate: number;
  activeBanners: number;
  deliveryExpired: number;
  deliveryFailed: number;
  deliveryPending: number;
  deliveryProcessing: number;
  scheduled: number;
}

interface NotificationListProps {
  deleteId: string | null;
  filters: AdminNotificationFilters;
  isLoading: boolean;
  loadError: string | null;
  notifications: NotificationWithStats[];
  onDeleteConfirm: () => void;
  onDeleteIdChange: (id: string | null) => void;
  onFiltersChange: (filters: AdminNotificationFilters) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onView: (id: string) => void;
  page: number;
  searchQuery: string;
  stats: AdminNotificationDashboardStats;
  totalCount: number;
}

const cards = [
  { key: 'totalSent', label: 'Total Sent', icon: Send },
  { key: 'deliveryPending', label: 'Pending', icon: Clock },
  { key: 'deliveryProcessing', label: 'Processing', icon: TimerReset },
  { key: 'deliveryFailed', label: 'Failed', icon: AlertTriangle },
  { key: 'deliveryExpired', label: 'Expired', icon: XCircle },
  { key: 'scheduled', label: 'Future Scheduled', icon: Clock },
  { key: 'avgReadRate', label: 'Avg Read Rate', icon: BarChart3 },
  { key: 'activeBanners', label: 'Active Banners', icon: Bell },
] as const;

export function NotificationList({
  deleteId,
  filters,
  isLoading,
  loadError,
  notifications,
  onDeleteConfirm,
  onDeleteIdChange,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onSearchChange,
  onView,
  page,
  searchQuery,
  stats,
  totalCount,
}: NotificationListProps) {
  const limit = 20;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Queue notifications for in-app, banner, and push delivery
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/notifications/create">
            <Plus className="size-4 mr-2" />
            Create Notification
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {cards.map(({ icon: Icon, key, label }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {key === 'avgReadRate' ? `${stats[key]}%` : stats[key]}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationListFilters
            filters={filters}
            onFiltersChange={onFiltersChange}
            onRefresh={onRefresh}
            onSearchChange={onSearchChange}
            searchQuery={searchQuery}
          />
          {isLoading ? (
            <div
              className="flex items-center justify-center py-8"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <span className="sr-only">Loading notifications</span>
            </div>
          ) : loadError ? (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">Notifications could not load.</p>
              <p>{loadError}</p>
              <Button
                className="mt-3"
                onClick={onRefresh}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <>
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="size-12 mx-auto mb-4 opacity-50" />
                <p>No notifications found</p>
                <Button asChild variant="link" className="mt-2">
                  <Link href="/admin/notifications/create">
                    Create your first notification
                  </Link>
                </Button>
              </div>
              {page > 0 && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                  >
                    Previous
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <NotificationListTable
                notifications={notifications}
                onDelete={onDeleteIdChange}
                onView={onView}
              />
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {page * limit + 1} to{' '}
                  {Math.min((page + 1) * limit, totalCount)} of {totalCount}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => onPageChange(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * limit >= totalCount}
                    onClick={() => onPageChange(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && onDeleteIdChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel pending notification?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes queued work before delivery begins. Sent, failed,
              processing, and expired delivery history is retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              Cancel Notification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
