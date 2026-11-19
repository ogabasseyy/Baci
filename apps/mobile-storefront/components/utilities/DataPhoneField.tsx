import { TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { dataFormStyles } from './data-form.styles';
import { UtilityFormNotice } from './UtilityFormNotice';

interface DataPhoneFieldProps {
  colors: typeof Colors.light;
  /** What is wrong with the finished number, shown under the field. */
  issue: string | null;
  onChangeText: (text: string) => void;
  value: string;
}

/** The data form's phone number input with its calm field notice. */
export function DataPhoneField({
  colors,
  issue,
  onChangeText,
  value,
}: DataPhoneFieldProps) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <TextInput
        style={[
          dataFormStyles.input,
          {
            backgroundColor: colors.muted,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
        placeholder="08012345678"
        placeholderTextColor={colors.placeholder}
        keyboardType="phone-pad"
        accessibilityLabel="Phone Number"
        value={value}
        onChangeText={onChangeText}
      />
      {issue ? <UtilityFormNotice compact message={issue} /> : null}
    </View>
  );
}
