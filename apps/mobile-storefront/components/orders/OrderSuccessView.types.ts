import type Colors from '@/constants/Colors';

export interface OrderSuccessViewProps {
  colors: typeof Colors.light;
  deliveryEstimate?: string;
  isDark: boolean;
  isDocumentLoading?: boolean;
  /**
   * While true the receipt preview is loading or open full-screen, so the
   * banner slot is withheld to avoid obscured delivery.
   */
  isReceiptPreviewActive?: boolean;
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
