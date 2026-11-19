import { useRef } from 'react';
import type { TextInputInstance } from 'react-native';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { getStyles } from './register.styles';

interface PersonNameFieldsProps {
  firstName: string;
  lastName: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onLastSubmit?: () => void;
}

function toSentenceCase(value: string): string {
  const firstCharacterIndex = value.search(/\S/);
  if (firstCharacterIndex === -1) {
    return value;
  }
  return `${value.slice(0, firstCharacterIndex)}${value
    .charAt(firstCharacterIndex)
    .toUpperCase()}${value.slice(firstCharacterIndex + 1).toLowerCase()}`;
}

export function PersonNameFields({
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
  onLastSubmit,
}: PersonNameFieldsProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const lastNameRef = useRef<TextInputInstance>(null);

  return (
    <View style={styles.nameRow}>
      <View style={styles.nameInputGroup}>
        <Text style={styles.label}>First Name</Text>
        <TextInput
          accessibilityLabel="First Name"
          style={styles.input}
          placeholder="John"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          value={firstName}
          onChangeText={(value) => onFirstNameChange(toSentenceCase(value))}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => lastNameRef.current?.focus()}
        />
      </View>
      <View style={styles.nameInputGroup}>
        <Text style={styles.label}>Last Name</Text>
        <TextInput
          ref={lastNameRef}
          accessibilityLabel="Last Name"
          style={styles.input}
          placeholder="Doe"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          value={lastName}
          onChangeText={(value) => onLastNameChange(toSentenceCase(value))}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={onLastSubmit}
        />
      </View>
    </View>
  );
}
