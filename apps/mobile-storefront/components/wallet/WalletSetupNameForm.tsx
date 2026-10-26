import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, type default as Colors, palette } from '@/constants/Colors';
import { WalletProfileNamesSchema } from '@/schemas/wallet-profile-names';

type Props = {
  colors: (typeof Colors)['light'];
  firstName?: string;
  lastName?: string;
  onSave: (names: {
    first_name: string;
    last_name: string;
  }) => Promise<{ success: boolean }>;
};

export function WalletSetupNameForm({
  colors,
  firstName = '',
  lastName = '',
  onSave,
}: Props) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    const parsed = WalletProfileNamesSchema.safeParse({
      first_name: first,
      last_name: last,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your name.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await onSave(parsed.data)).success)
        setError('Could not save your name. Please try again.');
    } catch {
      setError('Could not save your name. Please try again.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const inputStyle = {
    color: colors.text,
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  };
  return (
    <View style={{ gap: 16 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}
      >
        Complete your profile
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Add your name before we verify your identity and create your account
        number.
      </Text>
      <BottomSheetTextInput
        accessibilityLabel="First name"
        placeholder="First name"
        placeholderTextColor={colors.placeholder}
        value={first}
        onChangeText={setFirst}
        autoComplete="given-name"
        autoCapitalize="words"
        maxLength={100}
        editable={!busy}
        style={inputStyle}
      />
      <BottomSheetTextInput
        accessibilityLabel="Last name"
        placeholder="Last name"
        placeholderTextColor={colors.placeholder}
        value={last}
        onChangeText={setLast}
        autoComplete="family-name"
        autoCapitalize="words"
        maxLength={100}
        editable={!busy}
        style={inputStyle}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save and continue"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={save}
        style={{
          padding: 18,
          borderRadius: 16,
          backgroundColor: BRAND.primary,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: palette.white, fontWeight: '700' }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </Text>
      </Pressable>
    </View>
  );
}
