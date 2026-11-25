export const PAYMENT_METHODS_THEME_BASE_COLORS = {
  background: '#ffffff',
  border: '#e2e8f0',
  card: '#f8fafc',
  cardHover: '#f1f5f9',
  info: '#2563eb',
  infoLight: '#eff6ff',
  notification: '#dc2626',
  primary: '#2563eb',
  success: '#16a34a',
  successLight: '#dcfce7',
  text: '#0f172a',
  textMuted: '#64748b',
  textSecondary: '#334155',
} as const;

export const paymentSettings = {
  id: 'settings-1',
  merchant_id: 'merchant-1',
  paystack_enabled: true,
  korapay_enabled: true,
  credit_direct_enabled: false,
  credpal_enabled: false,
  pay_on_delivery_enabled: true,
  juicyway_enabled: false,
  klump_enabled: true,
  oxygen_enabled: false,
};
