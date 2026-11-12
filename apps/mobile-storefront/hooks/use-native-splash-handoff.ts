import { useEffect, useRef, useState } from 'react';
import SplashMotion from 'react-native-splash-motion';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { markStartupTiming } from '@/lib/startup-timing';
import {
  SPLASH_TIMEOUT_MS,
  useNativeSplashIntro,
} from './use-native-splash-intro';

interface NativeSplashHandoffOptions {
  initialVisible: boolean;
  ready: boolean;
}

export function useNativeSplashHandoff({
  initialVisible,
  ready,
}: NativeSplashHandoffOptions) {
  const [showSplash, setShowSplash] = useState(initialVisible);
  const [timedOut, setTimedOut] = useState(false);
  const [hasLayout, setHasLayout] = useState(false);
  const firstLayoutRecorded = useRef(false);
  const hidePromiseRef = useRef<Promise<void> | null>(null);
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
    if (!showSplash || !intro.settled || !(timedOut || (hasLayout && ready)))
      return;
    let active = true;
    if (!hidePromiseRef.current) {
      markStartupTiming('splash_hide_requested');
      hidePromiseRef.current = Promise.resolve()
        .then(() =>
          SplashMotion.hide({
            waitForLoop: !timedOut && !intro.completed,
            minDuration: timedOut || intro.completed ? 0 : 2500,
            fade: 220,
          })
        )
        .then(
          () => markStartupTiming('splash_hide_completed'),
          () => {
            recordCrashBreadcrumb('root_layout:native_splash_hide_failed');
            markStartupTiming('splash_hide_failed');
          }
        );
    }
    void hidePromiseRef.current.then(() => {
      if (active) setShowSplash(false);
    });
    return () => {
      active = false;
    };
  }, [showSplash, timedOut, ready, hasLayout, intro.settled, intro.completed]);

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
  };
}
