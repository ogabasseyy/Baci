import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsPhoneThumb } from './SavingsPhoneThumb';
import type { SavingsPhoneRow } from './savings-phone-rows';
import { styles } from './savings-phone-swap.styles';

type WalletColors = (typeof Colors)['light'];

/**
 * Step 1 of Change phone: the phone saved for now, a search, and the phones
 * the saved amount can move to. Phones cheaper than what is saved are left
 * out (one quiet line says so), never shown greyed out.
 */
export function SavingsPhonePickList({
  colors,
  goal,
  hiddenCount,
  loading,
  loadError,
  onBack,
  onPick,
  onSearchChange,
  rows,
  searchValue,
}: {
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  hiddenCount: number;
  loading: boolean;
  loadError: string | null;
  onBack: () => void;
  onPick: (row: SavingsPhoneRow) => void;
  onSearchChange: (value: string) => void;
  rows: SavingsPhoneRow[];
  searchValue: string;
}) {
  const saved = goal.current_amount;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to savings"
          onPress={onBack}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Ionicons name="swap-horizontal" size={20} color={colors.primary} />
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Change phone
        </Text>
      </View>
      <View style={[styles.current, { backgroundColor: palette.red[50] }]}>
        <SavingsPhoneThumb
          background={colors.background}
          iconColor={colors.primary}
          image={goal.product_image}
          title={goal.title}
        />
        <View style={styles.rowText}>
          <Text style={[styles.currentLabel, { color: palette.red[800] }]}>
            Saving for now
          </Text>
          <Text style={[styles.currentName, { color: palette.red[900] }]}>
            {`${goal.title} · ${formatNgnCurrency(saved)} saved`}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.search,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          accessibilityRole="search"
          accessibilityLabel="Search phones"
          value={searchValue}
          onChangeText={onSearchChange}
          placeholder="Search phones"
          placeholderTextColor={colors.placeholder}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>
      {loadError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.note, { color: colors.error }]}
        >
          {loadError}
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading phones"
          color={colors.primary}
        />
      ) : rows.length === 0 ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          No matching phones.
        </Text>
      ) : (
        rows.map((row) => {
          const preview = row.product.searchPreview === true;
          const name = `${row.title}${row.variantLabel ? ` ${row.variantLabel}` : ''}`;
          return (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${name}`}
              onPress={() => onPick(row)}
              style={[styles.row, { borderTopColor: colors.border }]}
            >
              <SavingsPhoneThumb
                background={colors.muted}
                iconColor={colors.textSecondary}
                image={row.image}
                title={row.title}
              />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>
                  {row.title}
                </Text>
                {row.meta.length > 0 ? (
                  <Text
                    style={[styles.rowMeta, { color: colors.textSecondary }]}
                  >
                    {row.meta.join(' · ')}
                  </Text>
                ) : null}
              </View>
              {preview ? (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textSecondary}
                />
              ) : (
                <View style={styles.rowEnd}>
                  <Text style={[styles.price, { color: colors.text }]}>
                    {formatNgnCurrency(row.price)}
                  </Text>
                  <Text
                    style={[
                      styles.chip,
                      {
                        backgroundColor: palette.red[50],
                        color: palette.red[800],
                      },
                    ]}
                  >
                    {`${formatNgnCurrency(Math.max(0, row.price - saved))} to go`}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })
      )}
      {hiddenCount > 0 ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {`Phones under ${formatNgnCurrency(saved)} are hidden. You've already saved more.`}
        </Text>
      ) : null}
    </View>
  );
}
