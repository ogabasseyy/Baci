import { useContext, useState } from 'react';
import {
  type KeyboardTypeOptions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { withAlpha } from '@/constants/palette';
import { OxygenButtonLabel } from './OxygenButtonLabel';
import { OxygenDraftSaveContext } from './OxygenDraftSaveContext';
export function useOxygenColors() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  return {
    ...colors,
    primary: BRAND.primary,
    primaryForeground: BRAND.onPrimary,
    primaryLowOpacity: withAlpha(
      BRAND.primary,
      scheme === 'dark' ? 0.14 : 0.08
    ),
    ring: BRAND.primary,
  };
}
export function OxygenField({
  label,
  value,
  onChange,
  error,
  keyboardType,
  secureTextEntry,
  editable = true,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  editable?: boolean;
}) {
  const colors = useOxygenColors();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const saveOnBlur = useContext(OxygenDraftSaveContext);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={styles.inputContainer}>
        <TextInput
          accessibilityLabel={label}
          value={value ?? ''}
          onChangeText={onChange}
          keyboardType={keyboardType}
          secureTextEntry={Boolean(secureTextEntry && !revealed)}
          editable={editable}
          autoCorrect={false}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            saveOnBlur?.();
          }}
          placeholderTextColor={colors.placeholder}
          style={[
            styles.input,
            secureTextEntry ? styles.sensitiveInput : undefined,
            {
              color: colors.text,
              backgroundColor: editable ? colors.card : colors.muted,
              borderColor: error || focused ? colors.primary : colors.border,
            },
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${label}`}
            accessibilityState={{ expanded: revealed }}
            onPress={() => setRevealed((current) => !current)}
            style={styles.revealButton}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 13 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function OxygenButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  loading?: boolean;
}) {
  const colors = useOxygenColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor:
            disabled && !loading
              ? colors.muted
              : secondary
                ? colors.card
                : colors.primary,
          borderColor: secondary ? colors.border : 'transparent',
        },
      ]}
    >
      <OxygenButtonLabel
        title={title}
        loading={loading}
        color={
          disabled && !loading
            ? colors.textSecondary
            : secondary
              ? colors.text
              : colors.primaryForeground
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8, marginBottom: 18 },
  label: { fontSize: 14, fontWeight: '600' },
  inputContainer: { position: 'relative' },
  sensitiveInput: { paddingRight: 58 },
  revealButton: {
    position: 'absolute',
    right: 5,
    top: 4,
    bottom: 4,
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    padding: 15,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import Ionicons from '@react-native-vector-icons/ionicons';
