interface ReplaySchedule {
  run: () => Promise<void>;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  report: (status: 'pass-complete' | 'pass-failed') => void;
}

export async function runReplaySchedule(input: ReplaySchedule): Promise<void> {
  while (!input.signal.aborted) {
    let delay = 60_000;
    try {
      await input.run();
      input.report('pass-complete');
    } catch {
      input.report('pass-failed');
      delay = 300_000;
    }
    if (input.signal.aborted) break;
    try {
      await input.wait(delay, input.signal);
    } catch {
      if (!input.signal.aborted) throw new Error('Staging replay wait failed');
    }
  }
}
