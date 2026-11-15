import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { setupStyles } from '../piggyvest-wallet-setup.styles';

/**
 * The BVN input: digits only, hidden by default with a show/hide toggle,
 * a counter, the "forgot it" hint, and its own error right under it.
 */
export function BvnField({
  colors,
  value,
  onChange,
  error,
  editable,
}: {
  colors: (typeof Colors)['light'];
  value: string;
  onChange: (digits: string) => void;
  error: string | null;
  editable: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  // Neutral at rest, ink (2pt) while typing, red only for a real error.
  // The brand colour is red too, so it is never the focus colour here.
  const borderColor = error
    ? colors.error
    : focused
      ? colors.text
      : colors.border;
  return (
    <View style={setupStyles.field}>
      <Text style={[setupStyles.fieldLabel, { color: colors.text }]}>
        Your BVN
      </Text>
      <View
        testID="bvn-input-wrap"
        style={[
          setupStyles.inputWrap,
          {
            backgroundColor: colors.muted,
            borderColor,
            borderWidth: focused || error ? 2 : 1.5,
          },
        ]}
      >
        <Ionicons
          accessible={false}
          importantForAccessibility="no"
          name="lock-closed-outline"
          size={18}
          color={colors.textSecondary}
        />
        <TextInput
          accessibilityLabel="BVN"
          value={value}
          onChangeText={(next) => onChange(next.replace(/\D/g, ''))}
          maxLength={11}
          keyboardType="number-pad"
          secureTextEntry={!visible}
          autoCorrect={false}
          textContentType="none"
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="11-digit BVN"
          placeholderTextColor={colors.placeholder}
          // Space typed digits only: a spaced placeholder reads oddly (#4229).
          style={[
            setupStyles.input,
            { color: colors.text, letterSpacing: value ? 2 : 0 },
          ]}
        />
        <Text style={[setupStyles.counter, { color: colors.textSecondary }]}>
          {value.length}/11
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide BVN' : 'Show BVN'}
          hitSlop={10}
          onPress={() => setVisible(!visible)}
        >
          <Ionicons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[setupStyles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : (
        <Text style={[setupStyles.hint, { color: colors.textSecondary }]}>
          Forgot it? Dial *565*0# from the phone number linked to your bank.
        </Text>
      )}
    </View>
  );
}
