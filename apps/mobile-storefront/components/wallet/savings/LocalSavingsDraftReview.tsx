import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { SavingsDraft } from '@/schemas/customer-savings-drafts';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

export function LocalSavingsDraftReview({
  draft,
  colors,
  busy,
  canStartNewDraft,
  onAccept,
  onStartNew,
  onClose,
}: {
  draft: SavingsDraft;
  colors: StartSavingsColors;
  busy: boolean;
  canStartNewDraft: boolean;
  onAccept: () => void;
  onStartNew: () => void;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        Review savings draft
      </Text>
      <View
        style={[
          styles.selectedProductCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Text style={[styles.selectedProductName, { color: colors.text }]}>
          {draft.device.name}
        </Text>
        <Text style={[styles.productMetaText, { color: colors.textSecondary }]}>
          {draft.device.condition} · {draft.device.variantLabel}
        </Text>
        <Text style={[styles.selectedProductPrice, { color: colors.primary }]}>
          Saved catalogue price: {formatNgnCurrency(draft.device.price)}
        </Text>
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          Not a price guarantee or activation.
        </Text>
      </View>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Draft disclosure
      </Text>
      <Text style={[styles.subheading, { color: colors.text }]}>
        {draft.terms.text}
      </Text>
      <Text style={[styles.productMetaText, { color: colors.textSecondary }]}>
        Terms version: {draft.terms.version}
      </Text>
      {draft.consent === 'accepted' ? (
        <Text
          accessibilityRole="alert"
          style={[styles.subheading, { color: colors.text }]}
        >
          Your draft and consent are saved. Funding and interest are not
          activated.
        </Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I have reviewed and accept these draft terms"
            accessibilityState={{ checked: accepted, disabled: busy }}
            disabled={busy}
            onPress={() => setAccepted((current) => !current)}
            style={styles.checkbox}
          >
            <View
              style={[
                styles.checkboxMark,
                {
                  borderColor: accepted ? BRAND.primary : colors.border,
                  backgroundColor: accepted ? BRAND.primary : colors.card,
                },
              ]}
            >
              {accepted ? (
                <Ionicons name="checkmark" size={12} color={palette.white} />
              ) : null}
            </View>
            <Text
              style={[styles.checkboxLabel, { color: colors.textSecondary }]}
            >
              I have reviewed and accept these draft terms
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm draft terms"
            accessibilityState={{ disabled: busy || !accepted }}
            disabled={busy || !accepted}
            onPress={onAccept}
            style={[
              styles.primaryButton,
              (busy || !accepted) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>Confirm draft terms</Text>
          </Pressable>
          {canStartNewDraft && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start new draft"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={onStartNew}
              style={[styles.outlineButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.outlineButtonText, { color: colors.text }]}>
                Start new draft
              </Text>
            </Pressable>
          )}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to my drafts"
        disabled={busy}
        accessibilityState={{ disabled: busy }}
        onPress={onClose}
        style={styles.modalCloseButton}
      >
        <Text style={[styles.modalCloseText, { color: colors.primary }]}>
          Back to my drafts
        </Text>
      </Pressable>
    </View>
  );
}
