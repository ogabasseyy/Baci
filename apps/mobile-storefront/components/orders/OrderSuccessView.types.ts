import type Colors from '@/constants/Colors';

export interface OrderSuccessViewProps {
  colors: typeof Colors.light;
  deliveryEstimate?: string;
  isDark: boolean;
  isDocumentLoading?: boolean;
  isPaid?: boolean;
  onContinueShopping: () => void;
  onLeaveGoogleReview: () => void;
  onPermissionDeny: () => void;
  onPermissionGrant: () => void;
  onViewDocument?: () => void;
  onViewOrders: () => void;
  orderNumber?: string;
  paymentMethod?: string;
  reference?: string;
  showPermissionModal: boolean;
}
