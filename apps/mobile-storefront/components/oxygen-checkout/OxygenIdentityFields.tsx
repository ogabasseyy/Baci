import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OxygenBirthDateField } from './OxygenBirthDateField';
import { OxygenField, useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenFields } from './oxygen-form-utils';

export function OxygenIdentityFields({
  fields,
  onChange,
  busy,
  errors,
}: {
  fields: OxygenFields;
  onChange: (patch: OxygenFields) => void;
  busy?: boolean;
  errors?: Partial<Record<keyof OxygenFields, string>>;
}) {
  const colors = useOxygenColors();
  const [editingContact, setEditingContact] = useState(false);
  const contactComplete = Boolean(
    fields.first_name?.trim() &&
      fields.last_name?.trim() &&
      fields.email?.trim()
  );
  const contactError = ['first_name', 'last_name', 'email'].some(
    (key) => errors?.[key as keyof OxygenFields]
  );
  return (
    <View>
      {contactComplete && !editingContact && !contactError ? (
        <View
          style={[
            styles.contact,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <View style={styles.contactText}>
            <Text style={[styles.name, { color: colors.text }]}>
              {[fields.first_name, fields.last_name].join(' ')}
            </Text>
            <Text style={[styles.email, { color: colors.textSecondary }]}>
              {fields.email}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit name and email"
            disabled={busy}
            onPress={() => setEditingContact(true)}
            style={styles.edit}
          >
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              Edit
            </Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {(
            [
              ['first_name', 'First name'],
              ['last_name', 'Last name'],
              ['middle_name', 'Middle name (optional)'],
              ['email', 'Email'],
            ] as const
          ).map(([key, label]) => (
            <OxygenField
              key={key}
              label={label}
              value={fields[key]}
              onChange={(value) => onChange({ [key]: value })}
              editable={!busy}
              error={errors?.[key]}
              keyboardType={key === 'email' ? 'email-address' : 'default'}
            />
          ))}
        </View>
      )}
      {(
        [
          ['bvn', 'BVN'],
          ['nin', 'NIN'],
        ] as const
      ).map(([key, label]) => (
        <OxygenField
          key={key}
          label={label}
          value={fields[key]}
          onChange={(value) => onChange({ [key]: value })}
          editable={!busy}
          error={errors?.[key]}
          keyboardType="number-pad"
          secureTextEntry
        />
      ))}
      <OxygenBirthDateField
        value={fields.date_of_birth}
        onChange={(date_of_birth) => onChange({ date_of_birth })}
        disabled={busy}
        error={errors?.date_of_birth}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
    marginBottom: 12,
  },
  contactText: { flex: 1, gap: 5 },
  name: { fontSize: 16, fontWeight: '600' },
  email: { fontSize: 14 },
  edit: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: 8,
  },
});
