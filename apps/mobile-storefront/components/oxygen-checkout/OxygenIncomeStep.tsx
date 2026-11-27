import { View } from 'react-native';
import { OxygenApplicationConsent } from './OxygenApplicationConsent';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import type { OxygenHomeAddressProps } from './OxygenHomeAddress';

export interface OxygenIncomeStepProps extends OxygenHomeAddressProps {
  consent: boolean;
  consentError?: string | null;
  onConsent: (value: boolean) => void;
}
export function OxygenIncomeStep(props: OxygenIncomeStepProps) {
  return (
    <View style={{ gap: 20 }}>
      <OxygenEmploymentFields {...props} />
      <OxygenApplicationConsent
        checked={props.consent}
        disabled={props.busy}
        error={props.consentError}
        onChange={props.onConsent}
      />
    </View>
  );
}
