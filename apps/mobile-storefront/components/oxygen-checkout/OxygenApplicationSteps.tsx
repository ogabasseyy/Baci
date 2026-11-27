import { useEffect, useRef } from 'react';
import { Text } from 'react-native';
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { OxygenActionFooter } from './OxygenActionFooter';
import { OxygenApplicationHeader } from './OxygenApplicationHeader';
import { OxygenBankStep, type OxygenBankStepProps } from './OxygenBankStep';
import { OxygenDraftSaveContext } from './OxygenDraftSaveContext';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';
import { OxygenIdentityFields } from './OxygenIdentityFields';
import {
  OxygenIncomeStep,
  type OxygenIncomeStepProps,
} from './OxygenIncomeStep';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';
export interface OxygenApplicationStepsProps
  extends OxygenBankStepProps,
    OxygenIncomeStepProps {
  accountConfirmed?: boolean;
  accountChecking?: boolean;
  bankError?: string | null;
  onRetryBanks?: () => void;
  submittingLabel?: string | null;
  step: 0 | 1 | 2;
  onStepChange: (step: 0 | 1 | 2) => void;
  onSubmit: () => void;
  error?: string | null;
  saving?: boolean;
  onFieldBlur?: () => void;
}
export function OxygenApplicationSteps(props: OxygenApplicationStepsProps) {
  const { step, fields, onChange, busy, onStepChange, onSubmit, error } = props;
  const colors = useOxygenColors();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const banksUnavailable = Boolean(props.onRetryBanks) && !props.banks.length;
  const hasEmploymentError = Boolean(
    props.errors?.employment_status ||
      props.errors?.name_of_employer ||
      props.errors?.salary_amount ||
      props.errors?.salary_date
  );
  useEffect(() => {
    if (step !== 2) return;
    if (props.consentError) {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    } else if (hasEmploymentError) {
      scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    }
  }, [step, props.consentError, hasEmploymentError]);
  return (
    <OxygenDraftSaveContext value={props.onFieldBlur}>
      <AppKeyboardAwareScrollView
        ref={scrollRef}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: step === 0 ? 12 : 24, paddingBottom: 24 }}
      >
        <OxygenApplicationHeader step={step} />
        {step > 0 && props.bankError && props.onRetryBanks ? (
          <>
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {props.bankError}
            </Text>
            <OxygenButton
              title="Retry loading banks"
              secondary
              disabled={busy || !props.active}
              onPress={props.onRetryBanks}
            />
          </>
        ) : null}
        {step === 0 ? (
          <OxygenIdentityFields
            fields={fields}
            onChange={onChange}
            busy={busy}
            errors={props.errors}
          />
        ) : step === 1 ? (
          <OxygenBankStep {...props} />
        ) : (
          <OxygenIncomeStep {...props} />
        )}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
        ) : null}
        <OxygenVerificationTrust />
        <OxygenActionFooter>
          <OxygenButton
            loading={
              Boolean(props.submittingLabel) ||
              busy ||
              (props.saving && step === 2) ||
              props.accountChecking
            }
            title={
              props.submittingLabel ??
              (props.saving && step === 2
                ? 'Saving details…'
                : busy
                  ? 'Please wait…'
                  : step === 2
                    ? props.accountChecking
                      ? 'Confirming bank account…'
                      : 'Continue verification'
                    : step === 1
                      ? 'Continue to income details'
                      : 'Continue')
            }
            disabled={
              busy ||
              (props.saving && step === 2) ||
              Boolean(props.submittingLabel) ||
              props.accountChecking ||
              !props.active ||
              (step > 0 && banksUnavailable) ||
              (step === 1 && props.accountConfirmed === false)
            }
            onPress={() =>
              step === 2 ? onSubmit() : onStepChange(step === 0 ? 1 : 2)
            }
          />
          {step > 0 ? (
            <OxygenButton
              title="Back"
              secondary
              disabled={busy || Boolean(props.submittingLabel)}
              onPress={() => onStepChange(step === 2 ? 1 : 0)}
            />
          ) : null}
        </OxygenActionFooter>
      </AppKeyboardAwareScrollView>
    </OxygenDraftSaveContext>
  );
}
