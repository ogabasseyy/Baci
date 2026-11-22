import type {
  OxygenApprovalCodeWindow,
  OxygenFormDraft,
  OxygenRuntimeAction,
} from '@baci/shared/oxygen';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenActionFooterProvider } from '../oxygen-checkout/OxygenActionFooter';
import { OxygenBookedAddress } from '../oxygen-checkout/OxygenBookedAddress';
import { OxygenDrawingControl } from '../oxygen-checkout/OxygenDrawingControl';
import { useOxygenColors } from '../oxygen-checkout/OxygenFormPrimitives';
import { OxygenOtp } from '../oxygen-checkout/OxygenOtp';
import { OxygenPaymentStep } from '../oxygen-checkout/OxygenPaymentStep';
import { OxygenStatusCard } from '../oxygen-checkout/OxygenStatusCard';
import { OxygenWorkflowBody } from '../oxygen-checkout/OxygenWorkflowBody';
import { OxygenAction } from '../oxygen-checkout/oxygen-presentation';
import {
  type OxygenProofPicker,
  OxygenProofPickerContext,
} from '../oxygen-checkout/use-oxygen-proof';
import {
  bookingReference,
  type PreviewStep,
  previewSnapshot,
  previewSteps,
  productAmount,
  sampleFields,
  sampleProof,
} from './fixtures';
import { LateApprovalPreview } from './LateApprovalPreview';

const picker: OxygenProofPicker = {
  pick: async () => ({
    canceled: false,
    assets: [
      {
        uri: 'mock://utility-bill',
        name: sampleProof.name,
        mimeType: sampleProof.type,
      },
    ],
  }),
  size: () => sampleProof.bytes.length,
  readBytes: async () => sampleProof.bytes,
};

const formStep = { identity: 0, bank: 1, income: 2 } as const;

export function OxygenPreview({ initial }: { initial: PreviewStep }) {
  const colors = useOxygenColors();
  const [step, setStep] = useState(initial);
  const [drawing, setDrawing] = useState(false);
  const [booking, setBooking] = useState({ equityPercentage: 25, tenure: 3 });
  const [version, setVersion] = useState(1);
  const [phoneSentAt, setPhoneSentAt] = useState(() =>
    new Date().toISOString()
  );
  const [phoneCode, setPhoneCode] = useState('');
  const [mock] = useState(() => ({
    draft: {
      step:
        initial in formStep ? formStep[initial as keyof typeof formStep] : 2,
      fields: sampleFields,
    } satisfies OxygenFormDraft as OxygenFormDraft,
    draftVersion: 0,
    window: null as OxygenApprovalCodeWindow | null,
  }));
  const [client] = useState(
    () =>
      ({
        draft: {
          read: async () => ({ draft: mock.draft, version: mock.draftVersion }),
          write: (input) => {
            mock.draft = input.draft;
            return Promise.resolve({ version: ++mock.draftVersion });
          },
        },
        bankDetails: (input) =>
          input.action === 'banks'
            ? Promise.resolve({
                banks: [
                  { name: 'Guaranty Trust Bank', code: '058' },
                  { name: 'Access Bank', code: '044' },
                  { name: 'Kuda Bank', code: '090267' },
                ],
              })
            : Promise.resolve({ accountName: 'Ada Example' }),
        approvalWindow: async () => ({ window: mock.window }),
      }) satisfies Pick<
        OxygenClient,
        'draft' | 'bankDetails' | 'approvalWindow'
      >
  );
  const snapshot = previewSnapshot(
    step,
    version,
    booking.equityPercentage,
    booking.tenure
  );
  function go(next: PreviewStep) {
    if (next in formStep)
      mock.draft = {
        ...mock.draft,
        step: formStep[next as keyof typeof formStep],
      };
    setPhoneCode('');
    if (next === 'phone') setPhoneSentAt(new Date().toISOString());
    if (next === 'breakdown') mock.window = null;
    setStep(next);
  }
  const [controller] = useState(() => ({
    getState: () => ({ error: null }),
    execute: (command: OxygenRuntimeAction) => {
      switch (command.action) {
        case 'start_application':
          go('phone');
          break;
        case 'refresh_eligibility':
          go('plan');
          break;
        case 'book':
          setBooking(command);
          go('address');
          break;
        case 'submit_address':
          go('review');
          break;
        case 'refresh_kyc':
          go('breakdown');
          break;
        case 'trigger_approval_otp': {
          const now = Date.now();
          mock.window = {
            bookingReference,
            sentAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 300_000).toISOString(),
          };
          setVersion((previous) => previous + 1);
          break;
        }
        case 'approve_booking':
          if (command.otp === '123456') go('payment');
          break;
      }
      return Promise.resolve();
    },
  }));
  const workflow = controller as unknown as OxygenWorkflowController;
  const mockClient = client as unknown as OxygenClient;
  const onRestart = () => go('identity');
  const stepIndex = previewSteps.indexOf(step);
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          Mock Oxygen · demo code 123456
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {previewSteps.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: step === item }}
              onPress={() => go(item)}
              style={{
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 9,
                backgroundColor:
                  step === item ? colors.primaryLowOpacity : colors.card,
              }}
            >
              <Text
                style={{
                  textTransform: 'capitalize',
                  color: step === item ? colors.primary : colors.text,
                }}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <OxygenProofPickerContext value={picker}>
        <OxygenActionFooterProvider>
          <OxygenDrawingControl value={setDrawing}>
            <ScrollView
              key={step}
              scrollEnabled={!drawing}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 16 }}
            >
              {step === 'phone' ? (
                <OxygenOtp
                  scopeKey="mock-phone"
                  value={phoneCode}
                  onChange={setPhoneCode}
                  pending={false}
                  confirmed={false}
                  sentAt={phoneSentAt}
                  onComplete={(code) => {
                    if (code === '123456') go('selfie');
                  }}
                  onResend={async () =>
                    setPhoneSentAt(new Date().toISOString())
                  }
                />
              ) : step === 'selfie' ? (
                <>
                  <OxygenStatusCard
                    eyebrow="IDENTITY VERIFICATION"
                    icon="checkmark-circle-outline"
                    title="Verify it’s you"
                    description="This preview simulates a successful selfie check."
                  />
                  <OxygenAction
                    label="Complete mock selfie"
                    onPress={() => go('eligibility')}
                  />
                </>
              ) : step === 'address' || step === 'review' ? (
                <OxygenBookedAddress
                  snapshot={snapshot}
                  client={mockClient}
                  busy={false}
                  onExecute={workflow.execute}
                  onRefresh={() => go('breakdown')}
                />
              ) : step === 'signature' || step === 'code' ? (
                <LateApprovalPreview
                  step={step}
                  snapshot={snapshot}
                  onSigned={() => go('code')}
                  onApproved={() => go('payment')}
                />
              ) : stepIndex >= 12 ? (
                <OxygenPaymentStep
                  state={step === 'complete' ? 'checkpoint' : 'ready'}
                  upfrontAmount={
                    snapshot.state.booking?.total_upfront_payment ?? undefined
                  }
                  paymentComplete={step !== 'payment'}
                  showRefresh={false}
                  onContinue={() =>
                    go(step === 'payment' ? 'setup' : 'complete')
                  }
                  onRefresh={() => undefined}
                />
              ) : (
                <OxygenWorkflowBody
                  focused
                  onViewOrders={onRestart}
                  snapshot={snapshot}
                  client={mockClient}
                  controller={workflow}
                  capabilities={null}
                  busy={false}
                  productAmount={productAmount}
                  scopeKey="mock-oxygen"
                  prefill={sampleFields}
                />
              )}
              {step === 'complete' ? (
                <OxygenAction
                  secondary
                  label="Restart preview"
                  onPress={onRestart}
                />
              ) : null}
            </ScrollView>
          </OxygenDrawingControl>
        </OxygenActionFooterProvider>
      </OxygenProofPickerContext>
    </SafeAreaView>
  );
}
