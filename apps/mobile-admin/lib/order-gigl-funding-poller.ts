import {
  GIGL_MAX_POLL_COUNT,
  GIGL_POLL_INTERVAL_MS,
} from './order-gigl-shipping-state';

const MAX_POLL_DURATION_MS = GIGL_MAX_POLL_COUNT * GIGL_POLL_INTERVAL_MS;

export interface OrderGiglPollContext {
  isCurrent: () => boolean;
  signal: AbortSignal;
  tickNumber: number;
}

type PollResult = 'continue' | 'stop';
type PollTick = (context: OrderGiglPollContext) => Promise<PollResult>;

export class OrderGiglFundingPoller {
  private controller: AbortController | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private running = false;
  private tickCount = 0;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly tick: PollTick,
    private readonly onLimit?: () => void
  ) {}

  start() {
    this.stop();
    this.running = true;
    this.tickCount = 0;
    this.generation += 1;
    const generation = this.generation;
    this.deadlineTimer = setTimeout(
      () => this.finishLimit(),
      MAX_POLL_DURATION_MS + 1
    );
    this.schedule(generation);
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.tickTimer = null;
    this.deadlineTimer = null;
  }

  private schedule(generation: number) {
    this.tickTimer = setTimeout(
      () => void this.run(generation),
      GIGL_POLL_INTERVAL_MS
    );
  }

  private async run(generation: number) {
    if (!this.isCurrent(generation)) return;
    const controller = new AbortController();
    this.controller = controller;
    const context: OrderGiglPollContext = {
      isCurrent: () => this.isCurrent(generation),
      signal: controller.signal,
      tickNumber: this.tickCount + 1,
    };
    let result: PollResult;
    try {
      result = await this.tick(context);
    } catch {
      result = 'stop';
    }
    if (!this.isCurrent(generation)) return;
    this.controller = null;
    this.tickCount += 1;
    if (this.tickCount >= GIGL_MAX_POLL_COUNT) {
      this.finishLimit();
      return;
    }
    if (result === 'stop') {
      this.stop();
      return;
    }
    this.schedule(generation);
  }

  private isCurrent(generation: number) {
    return this.running && this.generation === generation;
  }

  private finishLimit() {
    if (!this.running) return;
    this.stop();
    this.onLimit?.();
  }
}
