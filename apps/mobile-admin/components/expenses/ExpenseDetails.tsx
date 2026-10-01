import Ionicons from '@react-native-vector-icons/ionicons';
import { format, isValid, parseISO } from 'date-fns';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { getTranslucentColor } from '@/lib/colors/sanitize-css-color';
import { styles } from './expense-detail.styles';
import type { ExpenseDetailsProps } from './types';

export function ExpenseDetails({
  expense,
  branchName,
  colors,
  formattedAmount,
  groupName,
  receiptError = null,
  receiptLoading = false,
  receiptUrl,
  cardShadow,
}: ExpenseDetailsProps) {
  const parsedDate = parseISO(expense.date);
  const displayDate = isValid(parsedDate)
    ? format(parsedDate, 'MMMM d, yyyy')
    : 'Invalid date';
  const primaryBackground = getTranslucentColor(
    colors.primary,
    'rgba(59, 130, 246, 0.15)',
    0.15
  );
  const handleOpenReceipt = async () => {
    if (!receiptUrl) {
      Alert.alert('Receipt unavailable', 'No receipt image is attached.');
      return;
    }

    if (!/^https?:\/\//i.test(receiptUrl)) {
      Alert.alert('Receipt unavailable', 'This receipt link cannot be opened.');
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(receiptUrl);
      if (!canOpen) {
        Alert.alert(
          'Receipt unavailable',
          'This receipt link cannot be opened.'
        );
        return;
      }

      await Linking.openURL(receiptUrl);
    } catch {
      Alert.alert('Receipt unavailable', 'Could not open this receipt.');
    }
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
    >
      <View
        style={[
          styles.headerCard,
          { backgroundColor: colors.card },
          cardShadow,
        ]}
      >
        <View
          style={[styles.iconContainer, { backgroundColor: primaryBackground }]}
        >
          <Ionicons name="receipt-outline" size={32} color={colors.primary} />
        </View>
        <Text style={[styles.amountText, { color: colors.text }]}>
          {formattedAmount}
        </Text>
        <Text style={[styles.categoryText, { color: colors.textSecondary }]}>
          {expense.category}
        </Text>
      </View>

      <View
        style={[
          styles.infoSection,
          { backgroundColor: colors.card },
          cardShadow,
        ]}
      >
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Date
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {displayDate}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Vendor
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {expense.vendor_name ?? 'None'}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Payment method
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {expense.payment_method ?? 'None'}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Group
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {groupName}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Reference
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {expense.reference ?? 'None'}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Branch
          </Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {branchName}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
            Description
          </Text>
          <Text
            style={[
              styles.infoValue,
              { color: colors.text, textAlign: 'right' },
            ]}
          >
            {expense.description ?? 'No description provided'}
          </Text>
        </View>
      </View>

      {receiptUrl || expense.receipt_storage_path || expense.receipt_url ? (
        <View style={styles.receiptSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Receipt
          </Text>
          {receiptLoading ? (
            <Text style={[styles.receiptText, { color: colors.textSecondary }]}>
              Loading receipt…
            </Text>
          ) : receiptError ? (
            <Text style={[styles.receiptText, { color: colors.textSecondary }]}>
              Receipt unavailable. Try again.
            </Text>
          ) : (
            <Pressable
              style={[
                styles.receiptCard,
                { backgroundColor: colors.card },
                cardShadow,
              ]}
              onPress={() => {
                void handleOpenReceipt();
              }}
              accessibilityRole="button"
              accessibilityLabel="View attached receipt"
              accessibilityHint="Opens the attached receipt image"
            >
              <Ionicons name="image-outline" size={24} color={colors.primary} />
              <Text style={[styles.receiptText, { color: colors.primary }]}>
                View Attached Receipt
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
