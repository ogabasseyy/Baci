import { SHIPPING_PROVIDER_LABELS } from '@/constants/shipping-provider-labels';
import type { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';

interface Props {
  shipping: ReturnType<typeof useOrderGiglShipping>;
  selected: boolean;
  onSelect: () => void;
}

export function ShipmentFlowGiglMethod({
  shipping,
  selected,
  onSelect,
}: Props) {
  return (
    <ShipmentFlowGiglPanel
      addressDraft={shipping.addressDraft}
      error={shipping.error}
      fundingAccount={shipping.fundingAccount}
      missingFields={selected ? shipping.missingFields : []}
      onAddressFieldChange={shipping.updateAddressField}
      onEditAddress={shipping.beginAddressEdit}
      onFundWallet={() => void shipping.startFunding()}
      onPlaceSelect={shipping.selectAddressPlace}
      onRefreshFundingAccount={() => void shipping.refreshFundingAccount()}
      onModeChange={onSelect}
      onRetryQuote={() => void shipping.saveAddressAndRequestQuote()}
      onTransferred={shipping.startTransferPoll}
      providerName={SHIPPING_PROVIDER_LABELS.GIGL}
      quote={shipping.quote}
      selected={selected}
      state={shipping.state}
      wallet={shipping.wallet}
    />
  );
}
