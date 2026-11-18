import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OxygenAddressProof } from './OxygenAddressProof';
import { OxygenApplicationConsent } from './OxygenApplicationConsent';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import { useOxygenColors } from './OxygenFormPrimitives';
import {
  OxygenHomeAddress,
  type OxygenHomeAddressProps,
} from './OxygenHomeAddress';
import type { OxygenProofSource } from './oxygen-proof-source';
import type { OxygenProof } from './use-oxygen-proof';
export interface OxygenIncomeStepProps extends OxygenHomeAddressProps {
  consent: boolean;
  onConsent: (value: boolean) => void;
  proof: OxygenProof | null;
  onPickProof: (source?: OxygenProofSource) => void;
  proofError?: string | null;
  proofBusy?: boolean;
  proofReceived?: boolean;
}
export function OxygenIncomeStep(props: OxygenIncomeStepProps) {
  const colors = useOxygenColors();
  const payday = Number(props.fields.salary_date);
  const incomeComplete = Boolean(
    ['EMPLOYED', 'SELF_EMPLOYED', 'PENSIONER', 'UNEMPLOYED'].includes(
      props.fields.employment_status ?? ''
    ) &&
      /^\d+(\.\d{1,2})?$/.test(props.fields.salary_amount ?? '') &&
      Number.isInteger(payday) &&
      payday >= 1 &&
      payday <= 31
  );
  const [addressRevealed, setAddressRevealed] = useState(incomeComplete);
  useEffect(() => {
    if (incomeComplete) setAddressRevealed(true);
  }, [incomeComplete]);
  const showAddress = addressRevealed || incomeComplete;
  return (
    <View style={{ gap: 20 }}>
      <OxygenEmploymentFields {...props} />
      {showAddress ? (
        <>
          <View
            style={[
              styles.addressCard,
              {
                backgroundColor: colors.primaryLowOpacity,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.heading}>
              <View style={[styles.icon, { backgroundColor: colors.card }]}>
                <Ionicons
                  name="home-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: colors.text }]}
                >
                  Your home address
                </Text>
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  Must match your utility bill.
                </Text>
              </View>
            </View>
            <OxygenHomeAddress {...props} hideTitle />
            <OxygenAddressProof
              proof={props.proof}
              received={props.proofReceived}
              busy={props.busy || props.proofBusy}
              reading={props.proofBusy}
              error={props.proofError}
              onPick={props.onPickProof}
            />
          </View>
          <OxygenApplicationConsent
            checked={props.consent}
            disabled={props.busy}
            onChange={props.onConsent}
          />
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  addressCard: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 20 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  title: { fontSize: 17, fontWeight: '700' },
  help: { fontSize: 13, lineHeight: 20 },
});
