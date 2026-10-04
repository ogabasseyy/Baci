import type { piggyvestPolicyReviewSchemas } from '@baci/shared/contracts';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { z } from 'zod';
import type Colors from '@/constants/Colors';
import { piggyvestSavingsStyles as styles } from './PiggyvestSavingsScreen.styles';
import type { PiggyvestSavingsScreenInput } from './PiggyvestSavingsScreen.types';

type Draft = Extract<
  z.infer<typeof piggyvestPolicyReviewSchemas.view>,
  { status: 'draft' }
>;
type Theme = (typeof Colors)['light'];
type ReviewState = {
  draftKey: string;
  onAccept: PiggyvestSavingsScreenInput['onAccept'];
  checked: boolean;
  action: 'idle' | 'pending' | 'error' | 'submitted';
};
export function PiggyvestDraftReview({
  draft,
  colors,
  onAccept,
}: {
  draft: Draft;
  colors: Theme;
  onAccept: PiggyvestSavingsScreenInput['onAccept'];
}) {
  const draftKey = JSON.stringify(draft);
  const [state, setState] = useState<ReviewState>({
    draftKey,
    onAccept,
    checked: false,
    action: 'idle',
  });
  if (state.onAccept !== onAccept || state.draftKey !== draftKey) {
    setState({ draftKey, onAccept, checked: false, action: 'idle' });
  }
  const { checked, action } = state;
  const lifetime = useRef({ active: true });
  const inFlight = useRef<ReviewState | null>(null);
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => {
      current.active = false;
    };
  }, []);
  const disabled = action === 'pending' || action === 'submitted';
  async function accept() {
    const current = lifetime.current;
    if (
      !current.active ||
      !checked ||
      disabled ||
      (inFlight.current?.onAccept === onAccept &&
        inFlight.current.draftKey === draftKey) ||
      draft.consent !== 'required'
    )
      return;
    const pending: ReviewState = { ...state, action: 'pending' };
    inFlight.current = pending;
    setState(pending);
    try {
      await onAccept({
        goalId: draft.goalId,
        revisionId: draft.revisionId,
        termsVersion: draft.terms.version,
        termsHash: draft.terms.hash,
        accepted: true,
        ...(draft.durationMonths === undefined
          ? {}
          : { durationMonths: draft.durationMonths }),
      });
      if (current.active)
        setState((latest) =>
          latest === pending ? { ...latest, action: 'submitted' } : latest
        );
    } catch {
      if (current.active)
        setState((latest) =>
          latest === pending ? { ...latest, action: 'error' } : latest
        );
    } finally {
      if (inFlight.current === pending) inFlight.current = null;
    }
  }
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>
        {draft.device.productName}
      </Text>
      {draft.device.variant !== null && (
        <Text style={{ color: colors.text }}>{draft.device.variant}</Text>
      )}
      <Text style={{ color: colors.text }}>{draft.device.condition}</Text>
      {draft.durationMonths !== undefined && (
        <Text style={{ color: colors.text }}>
          Duration: {draft.durationMonths}{' '}
          {draft.durationMonths === 1 ? 'month' : 'months'}
        </Text>
      )}
      <Text style={[styles.label, { color: colors.text }]}>
        Terms — {draft.terms.version}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>
        {draft.terms.text}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.textSecondary }}
      >
        {draft.consent === 'accepted'
          ? 'Consent recorded for this draft.'
          : action === 'pending'
            ? 'Submitting acceptance…'
            : action === 'submitted'
              ? 'Acceptance submitted. Refresh to confirm recorded consent.'
              : 'Consent is required for this draft.'}
      </Text>
      {draft.consent === 'required' && (
        <>
          {action === 'error' && (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              Acceptance could not be confirmed. Retry or refresh this draft.
            </Text>
          )}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I accept the supplied terms for this draft"
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            onPress={() =>
              setState((latest) => ({ ...latest, checked: !latest.checked }))
            }
            style={[
              styles.control,
              { borderColor: colors.border },
              disabled && styles.disabled,
            ]}
          >
            <Text style={{ color: colors.text }}>
              {checked ? '☑' : '☐'} I accept the supplied terms for this draft
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              action === 'error' ? 'Retry acceptance' : 'Accept draft terms'
            }
            accessibilityState={{
              disabled: !checked || disabled,
              busy: action === 'pending',
            }}
            disabled={!checked || disabled}
            onPress={() => void accept()}
            style={[
              styles.control,
              { borderColor: colors.primary },
              (!checked || disabled) && styles.disabled,
            ]}
          >
            <Text style={{ color: colors.primary }}>
              {action === 'error' ? 'Retry acceptance' : 'Accept draft terms'}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
