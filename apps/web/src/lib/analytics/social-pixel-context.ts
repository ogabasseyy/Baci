type Destination = 'tiktok' | 'snapchat';
type ActivePixel = { id: string; ready: boolean };
const active: Partial<Record<Destination, ActivePixel>> = {};
/** SDK globals may survive a merchant transition; only the mounted pixel owns sends. */
export const socialPixelContext = {
  activate(destination: Destination, id: string): () => void {
    const pixel = { id, ready: false };
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
