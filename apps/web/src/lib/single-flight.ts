/** Coalesces concurrent work for a key without retaining settled results. */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(private readonly maxTrackedKeys = 1000) {}

  run(key: string, load: () => T | Promise<T>): Promise<T> {
    const current = this.inFlight.get(key);
    if (current) return current;

    const pending = Promise.resolve().then(load);
    if (this.inFlight.size >= this.maxTrackedKeys) return pending;

    this.inFlight.set(key, pending);
    void pending.then(
      () => this.deleteIfCurrent(key, pending),
      () => this.deleteIfCurrent(key, pending)
    );
    return pending;
  }

  forget(key: string): void {
    this.inFlight.delete(key);
  }

  private deleteIfCurrent(key: string, pending: Promise<T>): void {
    if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
  }
}
