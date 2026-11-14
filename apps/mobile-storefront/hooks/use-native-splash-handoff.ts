import { useEffect, useRef, useState } from 'react';
import SplashMotion from 'react-native-splash-motion';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { markStartupTiming } from '@/lib/startup-timing';
import { SPLASH_TIMEOUT_MS } from './splash-constants';
import { useNativeSplashIntro } from './use-native-splash-intro';

interface NativeSplashHandoffOptions {
  initialVisible: boolean;
  ready: boolean;
}

function readNativeSplashVisibility() {
  try {
    return SplashMotion.isVisible();
  } catch {
    // Fail open to recovery when the native visibility API is unavailable.
    return false;
  }
}

export function useNativeSplashHandoff({
  initialVisible,
  ready,
}: NativeSplashHandoffOptions) {
  const [showSplash, setShowSplash] = useState(initialVisible);
  const [timedOut, setTimedOut] = useState(false);
  const [hideFailed, setHideFailed] = useState(false);
  const [recoverySettled, setRecoverySettled] = useState(false);
  const [nativeSplashVisible, setNativeSplashVisible] = useState(true);
  const [hasLayout, setHasLayout] = useState(false);
  const firstLayoutRecorded = useRef(false);
  const hidePromiseRef = useRef<Promise<boolean> | null>(null);
  const intro = useNativeSplashIntro(initialVisible);

  useEffect(() => {
    if (!showSplash) return;
    const timeout = setTimeout(() => {
      recordCrashBreadcrumb('root_layout:splash_timeout');
      setTimedOut(true);
    }, SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [showSplash]);

  useEffect(() => {
    if (
      !showSplash ||
      hideFailed ||
      !(timedOut || (intro.settled && hasLayout && ready))
    )
      return;
    let active = true;
    if (!hidePromiseRef.current) {
      markStartupTiming('splash_hide_requested');
      hidePromiseRef.current = Promise.resolve()
        .then(() =>
          SplashMotion.hide({
            waitForLoop: false,
            minDuration: 0,
            fade: 220,
          })
        )
        .catch(() => {
          recordCrashBreadcrumb('root_layout:native_splash_hide_failed');
          markStartupTiming('splash_hide_failed');
          // A transient bridge error should not strand recovery behind native UI.
          return SplashMotion.hide({
            waitForLoop: false,
            minDuration: 0,
            fade: 0,
          });
        })
        .then(
          () => {
            markStartupTiming('splash_hide_completed');
            return true;
          },
          () => false
        );
    }
    void hidePromiseRef.current.then((hidden) => {
      if (!active) return;
      if (hidden) {
        setShowSplash(false);
      } else {
        // A one-off bridge failure can still be recoverable. Leave the cached
        // promise clear so the bounded recovery attempt below can call native
        // hide again.
        hidePromiseRef.current = null;
        setNativeSplashVisible(readNativeSplashVisibility());
        setHideFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [showSplash, timedOut, ready, hasLayout, intro.settled, hideFailed]);

  useEffect(() => {
    if (!showSplash || !hideFailed) return;
    let active = true;
    recordCrashBreadcrumb('root_layout:native_splash_hide_recovery_requested');
    const recoveryHidePromise = Promise.resolve()
      .then(() =>
        SplashMotion.hide({
          waitForLoop: false,
          minDuration: 0,
          fade: 0,
        })
      )
      .then(
        () => true,
        () => false
      );
    void recoveryHidePromise.then((hidden) => {
      if (!active) return;
      setRecoverySettled(true);
      if (hidden) {
        markStartupTiming('splash_hide_completed');
        setHideFailed(false);
        setShowSplash(false);
      } else {
        // Keep this as one bounded retry; a persistent native failure falls
        // through to StartupRecoveryScreen and the native watchdog.
        setNativeSplashVisible(readNativeSplashVisibility());
      }
    });
    return () => {
      active = false;
    };
  }, [showSplash, hideFailed]);

  useEffect(() => {
    if (!showSplash || (!hideFailed && !timedOut)) {
      setNativeSplashVisible(false);
      return;
    }

    let active = true;
    const syncVisibility = () => {
      const visible = readNativeSplashVisibility();
      if (active) setNativeSplashVisible(visible);
    };

    syncVisibility();
    const interval = setInterval(syncVisibility, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [showSplash, hideFailed, timedOut]);

  const onFirstLayout = () => {
    if (firstLayoutRecorded.current) return;
    firstLayoutRecorded.current = true;
    markStartupTiming('root_first_layout');
    setHasLayout(true);
  };

  return {
    showSplash,
    onFirstLayout,
    shouldRenderApp: intro.settled,
    timedOut,
    hasLayout,
    hideFailed,
    nativeSplashVisible,
    // Never place an interactive recovery screen above a native overlay that
    // still intercepts touch. SplashMotion's native 15s watchdog removes that
    // overlay if JS hide keeps failing; the visibility poll reveals recovery.
    shouldShowStartupRecovery:
      hideFailed && recoverySettled && !nativeSplashVisible,
  };
}
