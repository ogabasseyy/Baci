import { useEffect, useRef, useState } from 'react';
import SplashMotion from 'react-native-splash-motion';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { markStartupTiming } from '@/lib/startup-timing';

/** Native playback owns this boundary; app rendering must not race its frames. */
export function useNativeSplashIntro(initialVisible: boolean) {
  const [intro, setIntro] = useState({
    settled: !initialVisible,
    completed: false,
  });
  const promiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!initialVisible) return;
    let active = true;
    if (!promiseRef.current) {
      try {
        if (typeof SplashMotion.waitForIntro === 'function') {
          promiseRef.current = Promise.resolve(SplashMotion.waitForIntro());
        } else {
          recordCrashBreadcrumb('root_layout:native_intro_api_unavailable');
          promiseRef.current = Promise.resolve(false);
        }
      } catch (error) {
        promiseRef.current = Promise.reject(error);
      }
    }

    void promiseRef.current.then(
      (completed) => {
        if (!active) return;
        markStartupTiming(
          completed ? 'native_intro_completed' : 'native_intro_skipped'
        );
        setIntro({ settled: true, completed });
      },
      () => {
        if (!active) return;
        recordCrashBreadcrumb('root_layout:native_intro_wait_failed');
        markStartupTiming('native_intro_wait_failed');
        setIntro({ settled: true, completed: false });
      }
    );
    return () => {
      active = false;
    };
  }, [initialVisible]);

  return intro;
}
