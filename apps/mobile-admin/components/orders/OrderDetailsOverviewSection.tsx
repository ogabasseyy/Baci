import { View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { OrderDetailsCustomerCard } from './OrderDetailsCustomerCard';
import { OrderDetailsStatusCard } from './OrderDetailsStatusCard';
import type { OrderSourceInfo } from './order-details.types';

interface OrderDetailsOverviewSectionProps {
  colors: ThemeColors;
  placedOnLabel: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string | null;
  isGeneratingReceipt: boolean;
  onCall: () => void;
  onEmail: () => void;
  onRiderPhoneChange: (value: string) => void;
  onSendOrderDetailsToRider: () => void;
  onSendReceipt: () => void;
  onSendRiderToCustomer: () => void;
  onWhatsApp: () => void;
  recordedByName?: string | null;
  riderPhone: string;
  shippingColor: string;
  shippingConfig: { icon: string; label: string };
  shippingStatus: string;
  showPostShipmentActions: boolean;
  source?: string | null;
  sourceInfo: OrderSourceInfo;
  updatedAtLabel: string;
}

export function OrderDetailsOverviewSection({
  colors,
  placedOnLabel,
  customerEmail,
  customerName,
  customerPhone,
  isGeneratingReceipt,
  onCall,
  onEmail,
  onRiderPhoneChange,
  onSendOrderDetailsToRider,
  onSendReceipt,
  onSendRiderToCustomer,
  onWhatsApp,
  recordedByName,
  riderPhone,
  shippingColor,
  shippingConfig,
  shippingStatus,
  showPostShipmentActions,
  source,
  sourceInfo,
  updatedAtLabel,
}: OrderDetailsOverviewSectionProps) {
  return (
    <View>
      <OrderDetailsStatusCard
        colors={colors}
        placedOnLabel={placedOnLabel}
        recordedByName={recordedByName}
        shippingColor={shippingColor}
        shippingConfig={shippingConfig}
        shippingStatus={shippingStatus}
        source={source}
        sourceInfo={sourceInfo}
        updatedAtLabel={updatedAtLabel}
      />
      <OrderDetailsCustomerCard
        colors={colors}
        customerEmail={customerEmail}
        customerName={customerName}
        customerPhone={customerPhone}
        isGeneratingReceipt={isGeneratingReceipt}
        onCall={onCall}
        onEmail={onEmail}
        onRiderPhoneChange={onRiderPhoneChange}
        onSendOrderDetailsToRider={onSendOrderDetailsToRider}
        onSendReceipt={onSendReceipt}
        onSendRiderToCustomer={onSendRiderToCustomer}
        onWhatsApp={onWhatsApp}
        riderPhone={riderPhone}
        showPostShipmentActions={showPostShipmentActions}
      />
    </View>
  );
}
