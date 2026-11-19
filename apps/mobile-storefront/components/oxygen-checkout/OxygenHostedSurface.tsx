import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useCameraPermission } from '@/components/bnpl-checkout/use-camera-permission';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenHostedHeader } from './OxygenHostedHeader';
import { OxygenSelfieRecovery } from './OxygenSelfieRecovery';
import {
  createOxygenStatusRefresher,
  decideOxygenHostedNavigation,
  type OxygenHostedKind,
} from './oxygen-hosted-navigation';
import { OxygenAction } from './oxygen-presentation';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';
export interface OxygenHostedSurfaceProps {
  url: string;
  kind: OxygenHostedKind;
  capabilities: Pick<
    OxygenMobileCapabilities,
    'hostedOrigins' | 'selfieOrigins'
  >;
  active: boolean;
  onRefresh: () => Promise<unknown>;
  onExit: () => void;
  sessionExpired?: boolean;
  renewing?: boolean;
  renewalError?: string;
  onRenew?: () => void;
}
/** This surface can request status reads only. Completion belongs to the canonical workflow. */
export function OxygenHostedSurface(props: OxygenHostedSurfaceProps) {
  return <HostedSurface key={`${props.kind}:${props.url}`} {...props} />;
}
function HostedSurface({
  url,
  kind,
  capabilities,
  active,
  onRefresh,
  onExit,
  sessionExpired = false,
  renewing = false,
  renewalError,
  onRenew,
}: OxygenHostedSurfaceProps) {
  const colors = useOxygenColors();
  // Android WebView can default-allow when its JS policy callback times out.
  const embedded = Platform.OS === 'ios';
  const [error, setError] = useState('');
  const [pageLoaded, setPageLoaded] = useState(false);
  const loadFailed = useRef(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active'
  );
  const refreshCallback = useRef(onRefresh);
  refreshCallback.current = onRefresh;
  const [refreshState] = useState(() =>
    createOxygenStatusRefresher(
      () => refreshCallback.current(),
      kind === 'selfie' ? 15 : 8
    )
  );
  useEffect(() => {
    refreshState.start();
    return () => refreshState.stop();
  }, [refreshState]);
  const allowed =
    decideOxygenHostedNavigation(url, kind, capabilities) === 'allow';
  const camera = useCameraPermission(
    allowed &&
      active &&
      kind === 'selfie' &&
      pageLoaded &&
      !sessionExpired &&
      !renewing
  );
  useEffect(() => {
    if (
      !allowed ||
      !active ||
      kind !== 'selfie' ||
      !pageLoaded ||
      sessionExpired ||
      renewing
    )
      return;
    if (camera.status === 'granted')
      recordOxygenSelfieDiagnostic('camera_granted');
    if (camera.status === 'denied')
      recordOxygenSelfieDiagnostic('camera_denied');
  }, [
    allowed,
    active,
    kind,
    pageLoaded,
    camera.status,
    sessionExpired,
    renewing,
  ]);
  useEffect(() => {
    const guard = refreshState;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      void guard
        .refresh()
        .catch(() =>
          setError('Your progress is saved. Status is temporarily unavailable.')
        );
    };
    function sync(state: string) {
      setForeground(state === 'active');
      if (timer) clearInterval(timer);
      timer = undefined;
      if (active && !sessionExpired && !renewing && state === 'active') {
        refresh();
        timer = setInterval(refresh, kind === 'selfie' ? 15000 : 5000);
      }
    }
    // Initial navigation reads occur via hosted events; foreground resumes refresh once.
    if (
      active &&
      !sessionExpired &&
      !renewing &&
      AppState.currentState === 'active'
    )
      timer = setInterval(refresh, kind === 'selfie' ? 15000 : 5000);
    const listener = AppState.addEventListener('change', sync);
    return () => {
      if (timer) clearInterval(timer);
      listener.remove();
    };
  }, [active, refreshState, kind, sessionExpired, renewing]);
  function requestRefresh() {
    if (!active || !foreground || sessionExpired || renewing) return;
    void refreshState
      .refresh()
      .catch(() =>
        setError('Your progress is saved. Status is temporarily unavailable.')
      );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OxygenHostedHeader kind={kind} onExit={onExit} />
      {kind === 'selfie' && (sessionExpired || renewing) && (
        <OxygenSelfieRecovery
          renewing={renewing}
          error={renewalError}
          onRenew={onRenew}
        />
      )}
      {!allowed && (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          This provider link is unavailable. Your progress is saved.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      )}
      {allowed &&
        kind === 'selfie' &&
        !sessionExpired &&
        !renewing &&
        camera.status === 'denied' && (
          <View style={{ padding: 16, gap: 12 }}>
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.text, fontSize: 18, lineHeight: 26 }}
            >
              Camera access denied. Enable camera access in Settings to
              continue.
            </Text>
            <OxygenAction
              label={camera.canAskAgain ? 'Allow camera' : 'Open Settings'}
              onPress={() =>
                camera.canAskAgain
                  ? camera.retry()
                  : void Linking.openSettings().catch(() =>
                      setError(
                        'Could not open Settings. Enable camera access in your device settings.'
                      )
                    )
              }
            />
          </View>
        )}
      {allowed &&
        !embedded &&
        active &&
        foreground &&
        !sessionExpired &&
        !renewing && (
          <View style={{ padding: 16 }}>
            <OxygenAction
              label="Continue in browser"
              onPress={() => {
                setError('');
                void Linking.openURL(url).catch(() =>
                  setError(
                    'The provider page could not open. Your progress is saved.'
                  )
                );
              }}
            />
          </View>
        )}
      {allowed &&
        embedded &&
        active &&
        foreground &&
        !sessionExpired &&
        !renewing && (
          <WebView
            testID="oxygen-hosted"
            source={{ uri: url }}
            style={{ flex: 1 }}
            // WebView sends whitelist misses to Linking before our callback.
            // Keep iOS navigation in the decision-handler path below.
            originWhitelist={['*']}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            incognito
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows
            mediaCapturePermissionGrantType="prompt"
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={kind !== 'selfie'}
            onShouldStartLoadWithRequest={(request) =>
              decideOxygenHostedNavigation(request.url, kind, capabilities) ===
              'allow'
            }
            onOpenWindow={(event) => {
              const target = event.nativeEvent.targetUrl;
              const message =
                'This external page is unavailable. Return to saved progress for an update.';
              if (
                decideOxygenHostedNavigation(
                  target,
                  kind,
                  capabilities,
                  true
                ) === 'external'
              ) {
                setError('');
                void Linking.openURL(target).catch(() => setError(message));
              } else {
                setError(message);
              }
            }}
            onMessage={() => {
              if (kind !== 'selfie') requestRefresh();
            }}
            onLoadStart={() => {
              loadFailed.current = false;
            }}
            onLoadEnd={(event) => {
              if (kind !== 'selfie') requestRefresh();
              else if (
                !loadFailed.current &&
                decideOxygenHostedNavigation(
                  event.nativeEvent.url,
                  kind,
                  capabilities
                ) === 'allow'
              ) {
                if (!pageLoaded) recordOxygenSelfieDiagnostic('page_loaded');
                setPageLoaded(true);
              }
            }}
            onNavigationStateChange={() => {
              if (kind !== 'selfie') requestRefresh();
            }}
            onError={() => {
              if (kind === 'selfie')
                recordOxygenSelfieDiagnostic('page_load_failed');
              loadFailed.current = true;
              setError(
                'The provider page could not load. Your progress is saved.'
              );
            }}
            onHttpError={() => {
              if (kind === 'selfie')
                recordOxygenSelfieDiagnostic('page_http_failed');
              loadFailed.current = true;
              setError(
                'The provider link may have expired. Return to saved progress for an update.'
              );
            }}
          />
        )}
    </View>
  );
}
