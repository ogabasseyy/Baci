import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
/** Timing only: no codes, identity fields, provider tokens or consent are persisted. */
export function useOxygenPhoneMarker(scope: string) {
  const key = `${scope}:oxygen-phone-sent-at`;
  const [marker, setMarker] = useState<{ key: string; time: string } | null>(
    null
  );
  const liveKey = useRef(key);
  liveKey.current = key;
  const marked = useRef(false);
  useEffect(() => {
    let live = true;
    marked.current = false;
    void AsyncStorage.getItem(key).then(
      (value) => {
        if (
          live &&
          !marked.current &&
          value &&
          Number.isFinite(Date.parse(value)) &&
          Date.parse(value) <= Date.now()
        )
          setMarker({ key, time: value });
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [key]);
  function mark(time: string) {
    if (!Number.isFinite(Date.parse(time))) return;
    marked.current = true;
    const current = liveKey.current;
    setMarker({ key: current, time });
    void AsyncStorage.setItem(current, time).catch(() => undefined);
  }
  return { sentAt: marker?.key === key ? marker.time : null, mark };
}
