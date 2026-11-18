import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { OxygenBankLogo } from './OxygenBankLogo';
import { useOxygenColors } from './OxygenFormPrimitives';
import { filterOxygenBanks, type OxygenBank } from './oxygen-form-utils';

export function OxygenBankPicker({
  banks,
  value,
  disabled,
  onChange,
}: {
  banks: readonly OxygenBank[];
  value?: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const colors = useOxygenColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = banks.find((bank) => bank.code === value);
  const filtered = filterOxygenBanks(banks, query);
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>Bank</Text>
      <View
        style={[
          styles.control,
          {
            borderColor: open && !disabled ? colors.primary : colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable
          accessibilityRole="combobox"
          accessibilityLabel="Select bank"
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          onPress={() => setOpen(!open)}
          style={[
            styles.trigger,
            {
              borderBottomWidth: open ? 1 : 0,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <OxygenBankLogo code={selected?.code ?? ''} />
          <Text
            style={[
              styles.selected,
              { color: selected ? colors.text : colors.placeholder },
            ]}
          >
            {selected?.name ?? 'Select a bank'}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        {open && !disabled ? (
          <View style={[styles.dropdown, { backgroundColor: colors.card }]}>
            <View style={[styles.search, { borderColor: colors.border }]}>
              <Ionicons
                name="search-outline"
                size={20}
                color={colors.primary}
              />
              <TextInput
                accessibilityLabel="Search banks"
                placeholder="Search banks…"
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
                style={[styles.searchInput, { color: colors.text }]}
              />
            </View>
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={styles.list}
            >
              {filtered.map((bank) => (
                <Pressable
                  key={bank.code}
                  accessibilityRole="radio"
                  accessibilityLabel={bank.name}
                  accessibilityState={{
                    selected: value === bank.code,
                    disabled,
                  }}
                  disabled={disabled}
                  onPress={() => {
                    onChange(bank.code);
                    setOpen(false);
                    setQuery('');
                    Keyboard.dismiss();
                  }}
                  style={[
                    styles.option,
                    {
                      backgroundColor:
                        value === bank.code
                          ? colors.primaryLowOpacity
                          : colors.card,
                    },
                  ]}
                >
                  <OxygenBankLogo code={bank.code} />
                  <Text style={[styles.selected, { color: colors.text }]}>
                    {bank.name}
                  </Text>
                  {value === bank.code ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              ))}
              {!filtered.length ? (
                <Text style={{ color: colors.textSecondary, padding: 12 }}>
                  No banks found. Try another name.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginBottom: 18 },
  label: { fontSize: 14, fontWeight: '600' },
  control: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  trigger: {
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selected: { fontSize: 16, flex: 1 },
  dropdown: { padding: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 0,
    fontSize: 16,
  },
  list: { maxHeight: 260 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    minHeight: 50,
    borderRadius: 10,
  },
});
