import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { type Control, Controller, type FieldErrors } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { TextContentTypes } from '@/hooks/use-keyboard';
import type { ProfileFormData } from '@/schemas/profile-edit';
import { styles } from './profile-edit.styles';

type ProfileEditColors = typeof Colors.light;

interface ProfileFormFieldProps {
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  colors: ProfileEditColors;
  control: Control<ProfileFormData>;
  errors: FieldErrors<ProfileFormData>;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  label: string;
  name: keyof ProfileFormData;
  placeholder: string;
  textContentType?: ComponentProps<typeof TextInput>['textContentType'];
}

interface ProfileEditViewProps {
  colors: ProfileEditColors;
  control: Control<ProfileFormData>;
  customerEmail?: string | null;
  errors: FieldErrors<ProfileFormData>;
  isDirty: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  toast: ReactNode;
  // Rendered below the phone field. Kept separate from the react-hook-form
  // fields above: setting a username uses its own dedicated auth-store
  // action (setUsername), not updateProfile.
  usernameSection?: ReactNode;
}

function ProfileFormField({
  autoCapitalize = 'words',
  colors,
  control,
  errors,
  keyboardType = 'default',
  label,
  name,
  placeholder,
  textContentType,
}: ProfileFormFieldProps) {
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            accessibilityHint={`Enter your ${label.toLowerCase()}`}
            accessibilityLabel={label}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            keyboardType={keyboardType}
            onBlur={onBlur}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.placeholder}
            style={[
              styles.input,
              { backgroundColor: colors.muted, color: colors.text },
              { borderColor: errors[name] ? colors.error : colors.border },
            ]}
            textContentType={textContentType}
            value={value ?? ''}
          />
        )}
      />
      {errors[name] ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.errorText, { color: colors.error }]}
        >
          {errors[name]?.message}
        </Text>
      ) : null}
    </View>
  );
}

export function ProfileEditView({
  colors,
  control,
  customerEmail,
  errors,
  isDirty,
  isSubmitting,
  onSave,
  toast,
  usernameSection,
}: ProfileEditViewProps) {
  const isSaveDisabled = isSubmitting || !isDirty;

  return (
    <AppKeyboardContainer
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <View style={styles.formContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Personal Information
          </Text>

          <ProfileFormField
            colors={colors}
            control={control}
            errors={errors}
            label="First Name"
            name="first_name"
            placeholder="Enter your first name"
            textContentType={TextContentTypes.givenName}
          />
          <ProfileFormField
            colors={colors}
            control={control}
            errors={errors}
            label="Last Name"
            name="last_name"
            placeholder="Enter your last name"
            textContentType={TextContentTypes.familyName}
          />
          <ProfileFormField
            autoCapitalize="none"
            colors={colors}
            control={control}
            errors={errors}
            keyboardType="phone-pad"
            label="Phone Number"
            name="phone"
            placeholder="08012345678"
            textContentType={TextContentTypes.telephoneNumber}
          />

          {usernameSection}

          <Text style={[styles.emailLabel, { color: colors.textSecondary }]}>
            Email
          </Text>
          <View
            style={[
              styles.emailContainer,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emailText, { color: colors.text }]}>
              {customerEmail || 'Not set'}
            </Text>
            <Ionicons
              name="lock-closed"
              size={16}
              color={colors.textSecondary}
            />
          </View>
          <Text style={[styles.emailHint, { color: colors.textSecondary }]}>
            Email cannot be changed
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={[
          styles.bottomAction,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ]}
      >
        <Pressable
          accessibilityLabel="Save Changes"
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaveDisabled }}
          disabled={isSaveDisabled}
          onPress={onSave}
          style={[
            styles.saveButton,
            { backgroundColor: isDirty ? BRAND.primary : colors.border },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={BRAND.onPrimary} />
          ) : (
            <Text style={[styles.saveButtonText, { color: BRAND.onPrimary }]}>
              Save Changes
            </Text>
          )}
        </Pressable>
      </SafeAreaView>

      {toast}
    </AppKeyboardContainer>
  );
}
