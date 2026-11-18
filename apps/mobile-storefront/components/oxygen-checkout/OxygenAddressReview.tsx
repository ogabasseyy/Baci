import { View } from 'react-native';
import { OxygenStatusCard } from './OxygenStatusCard';
import {
  OxygenAction,
  oxygenPresentation as styles,
} from './oxygen-presentation';
export function OxygenAddressReview({
  status,
  busy = false,
  showRefresh = true,
  showSelectProof = true,
  onRefresh,
  onSelectProof,
}: {
  status: 'reviewing' | 'missing_proof' | 'received' | 'ready';
  busy?: boolean;
  showRefresh?: boolean;
  showSelectProof?: boolean;
  onRefresh: () => void;
  onSelectProof: () => void;
}) {
  return (
    <View style={[styles.section, { padding: 0 }]}>
      <OxygenStatusCard
        eyebrow="ADDRESS VERIFICATION"
        icon={status === 'reviewing' ? 'time-outline' : 'home-outline'}
        title={
          status === 'reviewing' ? 'Address under review' : 'Your home address'
        }
        description={
          status === 'reviewing'
            ? 'Oxygen is currently reviewing your address details'
            : status === 'ready'
              ? 'Your proof is selected. Submit your saved home address and proof to continue.'
              : status === 'received'
                ? 'Oxygen has received your address proof. Your progress is saved.'
                : 'Your address details are saved. Select the missing proof of address to continue.'
        }
      />
      {status === 'missing_proof' && showSelectProof ? (
        <OxygenAction
          label="Select proof of address"
          disabled={busy}
          onPress={onSelectProof}
        />
      ) : showRefresh && (status === 'reviewing' || status === 'received') ? (
        <OxygenAction
          label="Check for an update"
          disabled={busy}
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}
