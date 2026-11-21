import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenProofSource } from './oxygen-proof-source';
import { warmOxygenPhotoPicker } from './oxygen-proof-source';
import type { OxygenProof } from './use-oxygen-proof';

export function OxygenAddressProof({
  proof,
  received,
  busy,
  reading,
  error,
  onPick,
}: {
  proof: OxygenProof | null;
  received?: boolean;
  busy?: boolean;
  reading?: boolean;
  error?: string | null;
  onPick: (source?: OxygenProofSource) => void;
}) {
  const colors = useOxygenColors();
  const ready = received || !!proof;
  useEffect(() => {
    if (!received)
      void warmOxygenPhotoPicker().catch(() => {
        // A failed warm-up is retried on tap and shown through the normal picker error.
      });
  }, [received]);
  return (
    <View style={{ gap: 8 }}>
      <View
        style={[
          styles.card,
          {
            borderColor: error ? colors.error : colors.primary,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={styles.heading}>
          <Ionicons
            name={ready ? 'document-text-outline' : 'cloud-upload-outline'}
            size={26}
            color={ready ? colors.success : colors.primary}
          />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.title, { color: colors.text }]}>
              Utility bill / proof of address
            </Text>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              PDF, JPG or PNG · up to 1.5 MB
            </Text>
            <Text
              numberOfLines={2}
              style={[
                styles.help,
                { color: ready ? colors.success : colors.textSecondary },
              ]}
            >
              {received
                ? 'Document received'
                : (proof?.name ??
                  'Upload a document that matches this address.')}
            </Text>
            {reading || ready ? (
              <Text style={[styles.help, { color: colors.textSecondary }]}>
                {reading
                  ? 'Reading document…'
                  : received
                    ? 'Document received'
                    : 'Ready to upload'}
              </Text>
            ) : null}
          </View>
          <Ionicons
            name={ready ? 'checkmark-circle-outline' : 'add-circle-outline'}
            size={22}
            color={ready ? colors.success : colors.primary}
          />
        </View>
        {!received ? (
          <View style={styles.sources}>
            {(
              [
                ['photos', 'image-outline', 'Photo'],
                ['files', 'document-text-outline', 'PDF / file'],
              ] as const
            ).map(([source, icon, label]) => (
              <View
                key={source}
                style={[
                  styles.sourceBox,
                  {
                    backgroundColor: colors.primaryLowOpacity,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${proof ? 'Change' : 'Choose'} ${source === 'photos' ? 'photo' : 'file'}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => onPick(source)}
                  style={styles.sourceButton}
                >
                  <Ionicons name={icon} size={23} color={colors.primary} />
                  <Text style={[styles.action, { color: colors.primary }]}>
                    {label}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 13 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    gap: 16,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  help: { fontSize: 12, lineHeight: 18 },
  action: { fontSize: 13, fontWeight: '600' },
  sources: { flexDirection: 'row', gap: 10 },
  sourceBox: { flex: 1, borderWidth: 1, borderRadius: 14 },
  sourceButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
});
