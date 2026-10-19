export interface ScheduledNotification {
  action_url: string | null;
  channels: string[];
  delivery_claim_token: string;
  expires_at: string | null;
  id: string;
  message: string;
  target_merchant_ids: string[];
  target_segment: 'new' | 'active' | 'at_risk' | null;
  target_type: 'all' | 'specific' | 'segment';
  title: string;
}
