import { withTimeout } from '@baci/shared';
import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenHostedHeader } from './OxygenHostedHeader';
import { OxygenSelfieRecovery } from './OxygenSelfieRecovery';
import {
  canOpenOxygenHostedUrl,
  createOxygenStatusRefresher,
  type OxygenHostedKind,
} from './oxygen-hosted-navigation';
import { OxygenAction } from './oxygen-presentation';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';

const statusUnavailable =
  'Your progress is saved. Status is temporarily unavailable.';

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
  const [error, setError] = useState('');
  const [autoPaused, setAutoPaused] = useState(false);
  const [phase, setPhase] = useState<'opening' | 'checking' | null>(null);
  const openingBrowser = useRef(false);
  const awaitingBrowserReturn = useRef(false);
  const refreshCallback = useRef(onRefresh);
  refreshCallback.current = onRefresh;
  const [refreshState] = useState(() =>
    createOxygenStatusRefresher(
      () => refreshCallback.current(),
      kind === 'selfie' ? 15 : 8
    )
  );
  const allowed = canOpenOxygenHostedUrl(url, kind, capabilities);
  const available = allowed && active && !sessionExpired && !renewing;

  useEffect(() => {
    if (!available) return;
    refreshState.start();
    let timer: ReturnType<typeof setInterval> | undefined;
    function refresh() {
      if (openingBrowser.current) return;
      void refreshState.refresh().then(
        () => setAutoPaused(refreshState.isPaused()),
        () => {
          setAutoPaused(true);
          setError(statusUnavailable);
        }
      );
    }
    const interval = kind === 'selfie' ? 15000 : 5000;
    let appState = AppState.currentState;
    if (appState === 'active') timer = setInterval(refresh, interval);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === appState) return;
      appState = state;
      clearInterval(timer);
      if (state === 'active') {
        // Only a return from a launched Custom Tab restarts the polling budget.
        if (awaitingBrowserReturn.current) {
          awaitingBrowserReturn.current = false;
          refreshState.start();
          setError('');
        }
        refresh();
        timer = setInterval(refresh, interval);
      }
    });
    return () => {
      refreshState.stop();
      clearInterval(timer);
      listener.remove();
    };
  }, [available, kind, refreshState]);

  async function checkStatus() {
    setPhase('checking');
    setError('');
    setAutoPaused(false);
    refreshState.start();
    try {
      await withTimeout(
        refreshState.refresh(),
        8000,
        'Oxygen status timed out'
      );
    } catch {
      setAutoPaused(true);
      setError(statusUnavailable);
    } finally {
      setPhase(null);
    }
  }

  async function openBrowser() {
    if (!available || openingBrowser.current) return;
    openingBrowser.current = true;
    setPhase('opening');
    setError('');
    try {
      // Launch only the current pinned workflow link. The browser handles redirects.
      const result = await WebBrowser.openBrowserAsync(url);
      if (result.type === 'locked') throw new Error('Browser already open');
      if (result.type === 'opened') {
        awaitingBrowserReturn.current = true;
        return;
      }
      // iOS Safari reports dismissal. A dismissal only prompts a server read.
      if (kind === 'selfie') recordOxygenSelfieDiagnostic('browser_returned');
      await checkStatus();
    } catch {
      if (kind === 'selfie')
        recordOxygenSelfieDiagnostic('browser_open_failed');
      setError('The provider page could not open. Your progress is saved.');
    } finally {
      openingBrowser.current = false;
      setPhase(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OxygenHostedHeader kind={kind} onExit={onExit} />
      <View style={{ flex: 1, justifyContent: 'center', gap: 16, padding: 24 }}>
        {kind === 'selfie' && (sessionExpired || renewing) ? (
          <OxygenSelfieRecovery
            renewing={renewing}
            error={renewalError}
            onRenew={onRenew}
          />
        ) : null}
        {!allowed ? (
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            This provider link is unavailable. Your progress is saved.
          </Text>
        ) : null}
        {available ? (
          <>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 16,
                lineHeight: 24,
              }}
            >
              {kind === 'selfie'
                ? 'Complete your selfie on Oxygen’s secure page, then return here.'
                : 'Complete this step on Oxygen’s secure page, then return here.'}
            </Text>
            <OxygenAction
              label={
                phase === 'opening'
                  ? 'Opening Oxygen…'
                  : phase === 'checking'
                    ? 'Checking status…'
                    : 'Continue to Oxygen'
              }
              disabled={phase !== null}
              onPress={() => void openBrowser()}
            />
            {autoPaused ? (
              <OxygenAction
                label="Check status"
                secondary
                disabled={phase !== null}
                onPress={() => void checkStatus()}
              />
            ) : null}
          </>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
