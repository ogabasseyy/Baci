import type {
  OxygenRuntimeAction,
  OxygenRuntimeSnapshot,
  OxygenTransientFile,
} from '@baci/shared/oxygen';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenClientError } from '@/services/oxygen/errors';
import { OxygenAddressProof } from './OxygenAddressProof';
import { OxygenAddressReview } from './OxygenAddressReview';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';
import { OxygenHomeAddress } from './OxygenHomeAddress';
import type { OxygenFields } from './oxygen-form-utils';
import { useOxygenProof } from './use-oxygen-proof';
export function OxygenBookedAddress({
  snapshot,
  client,
  proof: prepared,
  checkoutAddress,
  busy,
  onExecute,
  onRefresh,
}: {
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  proof?: OxygenTransientFile;
  checkoutAddress?: {
    kind: 'pickup' | 'delivery';
    fields: OxygenFields;
  } | null;
  busy: boolean;
  onExecute: (
    command: OxygenRuntimeAction,
    file?: OxygenTransientFile
  ) => Promise<void>;
  onRefresh: () => void;
}) {
  const [fields, setFields] = useState<OxygenFields>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [edit, setEdit] = useState(false);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const colors = useOxygenColors();
  const picked = useOxygenProof(snapshot.workflowId);
  useEffect(() => {
    if (loadFailed) return;
    let live = true;
    void (async () => {
      try {
        const result = await client.draft.read(snapshot.workflowId);
        if (live) setFields(result.draft?.fields ?? {});
      } catch (failure) {
        if (!(failure instanceof OxygenClientError) || failure.status !== 409)
          throw failure;
        const context = await client.residentialContext(snapshot.workflowId);
        if (live) {
          setFields({
            home_state: context.address.state ?? '',
            home_lga: context.address.lga ?? '',
            home_city: context.address.city ?? '',
            home_street: context.address.street ?? '',
            home_landmark: context.address.landmark ?? '',
            home_house_number: context.address.house_number ?? '',
          });
          setRequiresConfirmation(context.source !== 'saved');
          setRecovered(true);
        }
      }
      if (live) setLoaded(true);
    })().catch(() => {
      if (live) setLoadFailed(true);
    });
    return () => {
      live = false;
    };
  }, [client, loadFailed, snapshot.workflowId]);
  const address = {
    state: fields.home_state ?? '',
    lga: fields.home_lga ?? '',
    city: fields.home_city ?? '',
    street: fields.home_street ?? '',
    landmark: fields.home_landmark ?? '',
    house_number: fields.home_house_number ?? '',
  };
  const complete = Object.values(address).every((v) => v.trim());
  const file = picked.proof ?? (!edit ? prepared : undefined);
  const waiting =
    snapshot.state.kyc?.address_status === 'PROCESSING' ||
    snapshot.pending?.action === 'submit_address';
  async function submit() {
    if (!file || !complete || (requiresConfirmation && !confirmed)) return;
    await onExecute({ action: 'submit_address', ...address }, file);
  }
  return (
    <View style={{ gap: 12 }}>
      <OxygenAddressReview
        status={waiting ? 'reviewing' : file ? 'ready' : 'missing_proof'}
        busy={busy || !loaded}
        showRefresh={loaded && !snapshot.pending}
        showSelectProof={false}
        onRefresh={onRefresh}
        onSelectProof={() => void picked.pick()}
      />
      {loaded && complete && !edit && !recovered ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            borderRadius: 16,
            padding: 16,
            gap: 5,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            Saved home address
          </Text>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {address.house_number} {address.street}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            {[...new Set([address.city, address.lga, address.state])].join(
              ', '
            )}
          </Text>
        </View>
      ) : null}
      {loadFailed ? (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            We couldn’t load your saved address.
          </Text>
          <OxygenButton
            title="Retry address lookup"
            secondary
            disabled={busy}
            onPress={() => setLoadFailed(false)}
          />
        </>
      ) : null}
      {!waiting && loaded ? (
        <>
          {!complete || edit || recovered ? (
            <OxygenHomeAddress
              fields={fields}
              checkoutAddress={checkoutAddress}
              onChange={(patch) => {
                setEdit(true);
                setConfirmed(false);
                setFields((previous) => ({ ...previous, ...patch }));
              }}
              busy={busy}
            />
          ) : null}
          {requiresConfirmation ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              onPress={() => setConfirmed(!confirmed)}
            >
              <Text style={{ color: colors.text }}>
                {confirmed ? '☑' : '☐'} This is my home address and matches my
                proof of address.
              </Text>
            </Pressable>
          ) : null}
          {!file ? (
            <OxygenAddressProof
              proof={picked.proof}
              busy={busy || picked.busy}
              reading={picked.busy}
              error={picked.error}
              onPick={(source) => void picked.pick(source)}
            />
          ) : null}
          {complete && !edit && !recovered ? (
            <OxygenButton
              title="Edit home address"
              secondary
              disabled={busy}
              onPress={() => setEdit(true)}
            />
          ) : null}
          {file ? (
            <OxygenButton
              title="Submit saved home address and proof"
              disabled={
                busy ||
                !complete ||
                (requiresConfirmation && !confirmed) ||
                !snapshot.executionEnabled ||
                Boolean(snapshot.pending)
              }
              onPress={() => void submit()}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
