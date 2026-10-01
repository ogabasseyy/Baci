import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export function useQuizResultRealtimeWakeup({
  enabled,
  eventId,
  onWakeup,
}: {
  enabled: boolean;
  eventId: string | null;
  onWakeup: () => void;
}) {
  const onWakeupRef = useRef(onWakeup);
  onWakeupRef.current = onWakeup;

  useEffect(() => {
    if (!enabled || !eventId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribe = async () => {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel(`quiz-results:${eventId}`, { config: { private: true } })
          .on('broadcast', { event: 'quiz_results_ready' }, () => {
            onWakeupRef.current();
          })
          .subscribe();
      } catch {
        // The bounded HTTP polling path remains authoritative when Realtime is
        // unavailable or private-channel authorization cannot be established.
      }
    };

    void subscribe();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, eventId]);
}
