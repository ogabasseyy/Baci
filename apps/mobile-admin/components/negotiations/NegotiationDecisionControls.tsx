import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  NegotiationCardColors,
  NegotiationStatus,
} from './NegotiationCard';
import { negotiationCardStyles as styles } from './NegotiationCard.styles';

interface NegotiationDecisionControlsProps {
  actionLoading: boolean;
  actionsDisabled: boolean;
  colors: NegotiationCardColors;
  itemId: string;
  onCounterOffer?: (id: string, amount: number) => void;
  onAction: (id: string, status: 'accepted' | 'rejected') => void;
  status: NegotiationStatus;
}

function formatNegotiationStatus(status: NegotiationStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function NegotiationDecisionControls({
  actionLoading,
  actionsDisabled,
  colors,
  itemId,
  onCounterOffer,
  onAction,
  status,
}: NegotiationDecisionControlsProps) {
  const [counterAmount, setCounterAmount] = useState('');
  const [showCounter, setShowCounter] = useState(false);
  const amount = Number(counterAmount);
  const validAmount =
    /^\d+(\.\d{1,2})?$/.test(counterAmount) &&
    amount > 0 &&
    amount <= 9999999999.99;
  if (status !== 'pending') {
    return (
      <View style={styles.statusOutcomeRow}>
        <Text
          style={[styles.statusOutcomeLabel, { color: colors.textSecondary }]}
        >
          Status
        </Text>
        <View
          style={[
            styles.statusOutcomeBadge,
            status === 'accepted' && {
              backgroundColor: colors.successLight,
            },
            status === 'rejected' && {
              backgroundColor: colors.errorLight,
            },
            status === 'countered' && {
              backgroundColor: colors.warningLight,
            },
          ]}
        >
          <Text
            style={[
              styles.statusOutcomeText,
              status === 'accepted' && { color: colors.success },
              status === 'rejected' && { color: colors.error },
              status === 'countered' && { color: colors.warning },
            ]}
          >
            {formatNegotiationStatus(status)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {onCounterOffer ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={actionsDisabled}
            onPress={() => setShowCounter(!showCounter)}
          >
            <Text style={{ color: colors.primary, paddingVertical: 12 }}>
              Counter Offer
            </Text>
          </Pressable>
          {showCounter ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.textSecondary }}>
                Counter offer amount (NGN)
              </Text>
              <TextInput
                accessibilityLabel="Counter offer amount (NGN)"
                keyboardType="decimal-pad"
                value={counterAmount}
                onChangeText={setCounterAmount}
                editable={!actionsDisabled}
                style={{
                  color: colors.text,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 12,
                }}
              />
              <Text style={{ color: colors.textSecondary }}>
                The customer will receive a push notification or email when
                available.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={actionsDisabled || !validAmount}
                onPress={() => onCounterOffer(itemId, amount)}
                style={[
                  styles.actionButton,
                  { backgroundColor: colors.primary, flex: undefined },
                  (actionsDisabled || !validAmount) && styles.disabledButton,
                ]}
              >
                <Text style={{ color: colors.textOnPrimary }}>
                  {actionLoading ? 'Sending…' : 'Send Counter Offer'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable
          style={[
            styles.actionButton,
            styles.rejectButton,
            { borderColor: colors.border },
            (actionLoading || actionsDisabled) && styles.disabledButton,
          ]}
          onPress={() => onAction(itemId, 'rejected')}
          disabled={actionsDisabled}
        >
          {actionLoading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text
              style={[styles.rejectButtonText, { color: colors.textSecondary }]}
            >
              Reject
            </Text>
          )}
        </Pressable>
        <Pressable
          style={[
            styles.actionButton,
            styles.acceptButton,
            { backgroundColor: colors.primary },
            (actionLoading || actionsDisabled) && styles.disabledButton,
          ]}
          onPress={() => onAction(itemId, 'accepted')}
          disabled={actionsDisabled}
        >
          {actionLoading ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text
              style={[styles.acceptButtonText, { color: colors.textOnPrimary }]}
            >
              Accept Offer
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
