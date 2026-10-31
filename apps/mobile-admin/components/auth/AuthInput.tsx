import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode, Ref } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  TextInput as NativeTextInput,
  StyleSheet,
  Text,
  type TextInputProps,
  View,
} from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

interface AuthInputProps {
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  blurOnSubmit?: boolean;
  borderColor: string;
  editable?: boolean;
  iconColor: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  inputRef?: Ref<TextInputInstance>;
  keyboardType?: TextInputProps['keyboardType'];
  label: string;
  labelColor: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  placeholder: string;
  placeholderTextColor: string;
  returnKeyType?: TextInputProps['returnKeyType'];
  rightAccessory?: ReactNode;
  secureTextEntry?: boolean;
  textColor: string;
  textContentType?: TextInputProps['textContentType'];
  value: string;
  wrapperColor: string;
}

export function AuthInput({
  autoCapitalize,
  autoComplete,
  blurOnSubmit,
  borderColor,
  editable = true,
  iconColor,
  iconName,
  inputRef,
  keyboardType,
  label,
  labelColor,
  onChangeText,
  onSubmitEditing,
  placeholder,
  placeholderTextColor,
  returnKeyType,
  rightAccessory,
  secureTextEntry,
  textColor,
  textContentType,
  value,
  wrapperColor,
}: AuthInputProps) {
  return (
    <View style={[styles.inputGroup, editable === false && { opacity: 0.5 }]}>
      <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      <View
        style={[
          styles.inputWrapper,
          { backgroundColor: wrapperColor, borderColor },
        ]}
      >
        <Ionicons
          name={iconName}
          size={20}
          color={iconColor}
          style={styles.inputIcon}
        />
        <NativeTextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityState={{ disabled: editable === false }}
          style={[styles.input, { color: textColor }]}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          textContentType={textContentType}
          editable={editable}
          returnKeyType={returnKeyType}
          blurOnSubmit={blurOnSubmit}
          onSubmitEditing={onSubmitEditing}
          secureTextEntry={secureTextEntry}
        />
        {rightAccessory}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputGroup: {
    gap: SPACING.xs,
  },
  label: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginLeft: SPACING.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous',
    paddingHorizontal: SPACING.md,
  },
  inputIcon: {
    marginRight: SPACING.sm,
  },
  input: {
    flex: 1,
    paddingVertical: SPACING.md,
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
});
