/**
 * Notification System Types
 *
 * Type definitions for the admin notification system that enables
 * platform admins to send notifications to merchants via in-app
 * notification center and site banners.
 */

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export type NotificationType = 'info' | 'success' | 'warning' | 'error';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TargetType = 'all' | 'specific' | 'segment';
export type NotificationChannel = 'in_app' | 'banner' | 'push';
export type TargetSegment = 'new' | 'active' | 'at_risk';
export type NotificationDeliveryState =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'expired'
  | 'failed';

// ============================================================================
// DATABASE MODELS
// ============================================================================

/**
 * Main notification entity created by admins
 */
export interface Notification {
  id: string;
  template_id: string | null;
  title: string;
  message: string;
  notification_type: NotificationType;
  priority: NotificationPriority;
  target_type: TargetType;
  target_merchant_ids: string[];
  target_segment: TargetSegment | null;
  channels: NotificationChannel[];
  action_url: string | null;
  action_label: string | null;
  scheduled_for: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  delivery_attempts: number;
  delivery_last_error: string | null;
  delivery_state: NotificationDeliveryState;
  sent_at: string | null;
  is_system: boolean;
}

/**
 * Per-merchant notification delivery record
 */
interface MerchantNotification {
  id: string;
  notification_id: string;
  merchant_id: string;
  read_at: string | null;
  dismissed_at: string | null;
  banner_dismissed_at: string | null;
  created_at: string;
}

/**
 * Merchant notification with joined notification data
 */
export interface MerchantNotificationWithDetails extends MerchantNotification {
  notification: Notification;
}

/**
 * Merchant notification preferences
 */
export interface NotificationPreferences {
  merchant_id: string;
  in_app_enabled: boolean;
  banner_enabled: boolean;
  follow_up_notifications_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_time_zone: string;
  updated_at: string;
}

// ============================================================================
// API INPUT TYPES
// ============================================================================

/**
 * Input for creating a new notification
 */
export interface CreateNotificationInput {
  title: string;
  message: string;
  notification_type: NotificationType;
  priority: NotificationPriority;
  target_type: TargetType;
  target_merchant_ids?: string[];
  target_segment?: TargetSegment;
  channels: NotificationChannel[];
  action_url?: string;
  action_label?: string;
  scheduled_for?: string;
  expires_at?: string;
  template_id?: string;
}

/**
 * Input for updating a notification (only before sent)
 */
export interface UpdateNotificationInput {
  title?: string;
  message?: string;
  notification_type?: NotificationType;
  priority?: NotificationPriority;
  target_type?: TargetType;
  target_merchant_ids?: string[];
  target_segment?: TargetSegment;
  channels?: NotificationChannel[];
  action_url?: string | null;
  action_label?: string | null;
  scheduled_for?: string | null;
  expires_at?: string | null;
}

/**
 * Input for updating notification preferences
 */
export interface UpdatePreferencesInput {
  in_app_enabled?: boolean;
  banner_enabled?: boolean;
  follow_up_notifications_enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_time_zone?: string;
}

/**
 * Input for marking notification as read/dismissed
 */
export interface UpdateMerchantNotificationInput {
  read?: boolean;
  dismissed?: boolean;
  banner_dismissed?: boolean;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Notification delivery statistics
 */
export interface NotificationStats {
  total_sent: number;
  total_push_sent?: number;
  total_read: number;
  total_dismissed: number;
  read_rate: number;
}

/**
 * Notification with delivery stats (for admin view)
 */
export interface NotificationWithStats extends Notification {
  stats: NotificationStats;
}

/**
 * Active banner notification for display
 */
export interface ActiveBanner {
  id: string;
  notification_id: string;
  title: string;
  message: string;
  notification_type: NotificationType;
  priority: NotificationPriority;
  action_url: string | null;
  action_label: string | null;
  created_at: string;
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

// ============================================================================
// FILTER AND QUERY TYPES
// ============================================================================

/**
 * Filters for admin notification list
 */
export interface AdminNotificationFilters {
  status?:
    | 'all'
    | 'sent'
    | 'scheduled'
    | 'queued'
    | 'processing'
    | 'failed'
    | 'expired';
  type?: NotificationType;
  priority?: NotificationPriority;
  date_from?: string;
  date_to?: string;
  search?: string;
}

/**
 * Filters for merchant notification list
 */
export interface MerchantNotificationFilters {
  unread_only?: boolean;
  type?: NotificationType;
}
