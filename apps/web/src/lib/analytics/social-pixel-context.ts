type Destination = 'tiktok' | 'snapchat';
type ActivePixel = { id: string; ready: boolean };
const active: Partial<Record<Destination, ActivePixel>> = {};
const prepared = new WeakSet<ActivePixel>();
/** SDK globals may survive a merchant transition; only the mounted pixel owns sends. */
export const socialPixelContext = {
  /** Establish a tenant-bound owner before a deferred provider loads. */
  prepare(destination: Destination, id: string): () => void {
    const pixel = { id, ready: false };
    prepared.add(pixel);
    active[destination] = pixel;
    return () => {
      prepared.delete(pixel);
      if (active[destination] === pixel) delete active[destination];
    };
  },
  activate(destination: Destination, id: string): () => void {
    const candidate = active[destination];
    const pixel =
      candidate?.id === id && prepared.has(candidate)
        ? candidate
        : { id, ready: false };
    prepared.delete(pixel);
    active[destination] = pixel;
    return () => {
      if (active[destination] === pixel) delete active[destination];
    };
  },
  markReady(destination: Destination, id: string): void {
    const pixel = active[destination];
    if (pixel?.id === id) pixel.ready = true;
  },
  get(destination: Destination): Readonly<ActivePixel> | undefined {
    return active[destination];
  },
};
