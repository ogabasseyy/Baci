import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { ThemeColors } from '@/constants/theme';
import { isNativePreviewNavigationAllowed } from './native-preview-script';
import { useNativePreviewBridge } from './use-native-preview-bridge';

export interface NativeCustomizePreviewPaneProps {
  colors: ThemeColors;
  identityKey: string;
  draftRevision: number;
  config: unknown;
  merchant: {
    id: string;
    slug: string;
    basePath?: string;
    storefrontOrigin?: string;
  };
  isIdentityCurrent: () => boolean;
  previewUrl: string;
  onFallback?: () => void;
  onSlotRendered?: () => void;
  onSlotFailure?: () => void;
}

export function NativeCustomizePreviewPane({
  colors,
  previewUrl,
  onFallback,
  onSlotRendered,
  onSlotFailure,
  ...input
}: NativeCustomizePreviewPaneProps) {
  const bridge = useNativePreviewBridge(input);
  const nonce = bridge.nonce;
  const instance = bridge.instanceId;
  const validUrl = isNativePreviewNavigationAllowed(previewUrl, previewUrl);
  useEffect(() => {
    if (bridge.hasRendered && !bridge.pending && !bridge.error)
      onSlotRendered?.();
  }, [bridge.hasRendered, bridge.pending, bridge.error, onSlotRendered]);
  useEffect(() => {
    if (bridge.error || !validUrl) onSlotFailure?.();
  }, [bridge.error, validUrl, onSlotFailure]);
  return (
    <View style={styles.container} accessibilityLabel="Storefront preview">
      {validUrl && nonce ? (
        <WebView
          key={instance}
          ref={(view) => {
            bridge.webViewRef.current = view;
          }}
          source={{ uri: previewUrl }}
          originWhitelist={[new URL(previewUrl).origin]}
          onShouldStartLoadWithRequest={(request) =>
            isNativePreviewNavigationAllowed(request.url, previewUrl)
          }
          onLoadStart={(event) => {
            if (
              isNativePreviewNavigationAllowed(
                event.nativeEvent.url,
                previewUrl
              )
            )
              bridge.onLoadStart(instance, nonce);
            else bridge.onLoadError(instance, nonce);
          }}
          onLoad={(event) => {
            if (
              isNativePreviewNavigationAllowed(
                event.nativeEvent.url,
                previewUrl
              )
            )
              bridge.onLoad(instance, nonce);
            else bridge.onLoadError(instance, nonce);
          }}
          onError={() => bridge.onLoadError(instance, nonce)}
          onMessage={(event) =>
            bridge.onMessage(instance, nonce, event.nativeEvent.data)
          }
          style={styles.webview}
        />
      ) : null}
      {!bridge.hasRendered && !bridge.error && validUrl ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {bridge.error || !validUrl ? (
        <View style={[styles.error, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.textSecondary }}>
            Preview not available
          </Text>
          {onFallback ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View published store"
              onPress={onFallback}
            >
              <Text style={{ color: colors.primary }}>
                View published store
              </Text>
            </Pressable>
          ) : null}
          {validUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry preview"
              onPress={bridge.retry}
            >
              <Text style={{ color: colors.primary }}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  overlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { padding: 12, alignItems: 'center' },
});
