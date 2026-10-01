'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiDelete } from '@/lib/api-client';
import type {
  AdminNotificationFilters,
  NotificationWithStats,
} from '@/types/notifications';
import {
  type AdminNotificationDashboardStats,
  NotificationList,
} from './components/notification-list';

const PAGE_LIMIT = 20;

interface NotificationsPageResult {
  notifications: NotificationWithStats[];
  totalCount: number;
  stats: AdminNotificationDashboardStats;
}

async function fetchAdminNotifications(
  filters: AdminNotificationFilters,
  searchQuery: string,
  page: number
): Promise<NotificationsPageResult> {
  const params = new URLSearchParams({
    limit: PAGE_LIMIT.toString(),
    offset: (page * PAGE_LIMIT).toString(),
  });
  if (filters.status && filters.status !== 'all')
    params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.priority) params.set('priority', filters.priority);
  if (searchQuery) params.set('search', searchQuery);

  const response = await fetch(`/api/admin/notifications?${params}`);
  if (!response.ok) throw new Error('Failed to fetch notifications');
  const data = await response.json();
  const dashboard = data.dashboard as {
    activeBanners: number;
    avgReadRate: number;
    deliveryExpired: number;
    deliveryFailed: number;
    deliveryPending: number;
    deliveryProcessing: number;
    scheduled: number;
    totalSent: number;
  };
  return {
    notifications: data.data as NotificationWithStats[],
    totalCount: data.pagination.total,
    stats: {
      totalSent: dashboard.totalSent,
      avgReadRate: Math.round(dashboard.avgReadRate),
      activeBanners: dashboard.activeBanners,
      deliveryExpired: dashboard.deliveryExpired,
      deliveryFailed: dashboard.deliveryFailed,
      deliveryPending: dashboard.deliveryPending,
      deliveryProcessing: dashboard.deliveryProcessing,
      scheduled: dashboard.scheduled,
    },
  };
}

export default function AdminNotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationWithStats[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdminNotificationFilters>({
    status: 'all',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState<AdminNotificationDashboardStats>({
    totalSent: 0,
    avgReadRate: 0,
    activeBanners: 0,
    deliveryExpired: 0,
    deliveryFailed: 0,
    deliveryPending: 0,
    deliveryProcessing: 0,
    scheduled: 0,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey explicitly triggers manual reloads.
  useEffect(() => {
    let active = true;
    fetchAdminNotifications(filters, searchQuery, page)
      .then((result) => {
        if (active) {
          setLoadError(null);
          setNotifications(result.notifications);
          setTotalCount(result.totalCount);
          setStats(result.stats);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          console.error('Error fetching notifications:', error);
          setLoadError('Notifications could not be loaded.');
          toast({
            title: 'Error',
            description: 'Failed to fetch notifications',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, filters, searchQuery, toast, refreshKey]);

  const reload = () => {
    setIsLoading(true);
    setRefreshKey((key) => key + 1);
  };
  const updateFilters = (value: AdminNotificationFilters) => {
    setIsLoading(true);
    setPage(0);
    setFilters(value);
  };
  const updateSearch = (value: string) => {
    setIsLoading(true);
    setPage(0);
    setSearchQuery(value);
  };
  const updatePage = (value: number) => {
    setIsLoading(true);
    setPage(value);
  };
  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/admin/notifications/${deleteId}`);
      toast({
        title: 'Cancelled',
        description: 'Pending notification has been cancelled',
      });
      reload();
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel pending notification',
        variant: 'destructive',
      });
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <NotificationList
      deleteId={deleteId}
      filters={filters}
      isLoading={isLoading}
      loadError={loadError}
      notifications={notifications}
      onDeleteConfirm={confirmDelete}
      onDeleteIdChange={setDeleteId}
      onFiltersChange={updateFilters}
      onPageChange={updatePage}
      onRefresh={reload}
      onSearchChange={updateSearch}
      onView={(id) => router.push(`/admin/notifications/${id}`)}
      page={page}
      searchQuery={searchQuery}
      stats={stats}
      totalCount={totalCount}
    />
  );
}
