import type Colors from '@/constants/Colors';

export interface OrderSuccessViewProps {
  colors: typeof Colors.light;
  deliveryEstimate?: string;
  isDark: boolean;
  isDocumentLoading?: boolean;
  /**
   * Prior-payment evidence (partial payment or pre-gateway credit) that
   * makes the generated preview a commercial invoice even though the
   * order is not fully paid: the presentation must agree with the
   * document instead of rendering proforma copy.
   */
  isCommercialDocument?: boolean;
  isPaid?: boolean;
  /**
   * While true the notification permission flow is in progress — including
   * the native system prompt after the soft-ask modal closes — so the
   * banner slot stays unmounted underneath it.
   */
  isPermissionFlowActive?: boolean;
  /**
   * While true the receipt preview is loading or open full-screen, so the
   * banner slot is withheld to avoid obscured delivery.
   */
  isReceiptPreviewActive?: boolean;
  /**
   * While true a presented post-order interstitial owns the full screen, so
   * the banner slot stays unmounted until it closes.
   */
  isFullscreenAdActive?: boolean;
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
