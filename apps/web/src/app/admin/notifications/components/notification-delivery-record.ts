export interface NotificationDeliveryRecord {
  id: string;
  merchant_id: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  business_name: string;
}
