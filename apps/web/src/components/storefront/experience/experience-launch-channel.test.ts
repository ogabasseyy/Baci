import { expect, it, vi } from 'vitest';
import { bindExperiencePort } from './experience-launch-channel';

it('binds once before src load, rejects nonce spoofing and destroys on document reload', () => {
  const channels: Array<{ port1: Port; port2: Port }> = [];
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'src', {
      set() {
        frame.dispatchEvent(new Event('load'));
      },
    });
    const destroyed = vi.fn();
    const receive = vi.fn();
    const legacyReady = vi.fn();
    const connection = bindExperiencePort(
      frame,
      {
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
        nonce: 'secret',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {
          route: { epoch: 1 },
          catalog: { products: [] },
          capabilities: [],
        },
      } as never,
      receive,
      destroyed,
      legacyReady
    );
    channels[0].port1.onmessage?.({ data: { type: 'ready', nonce: 'secret' } });
    expect(channels[0].port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrap' })
    );
    expect(legacyReady).toHaveBeenCalledOnce();
    frame.dispatchEvent(new Event('load'));
    expect(destroyed).toHaveBeenCalledOnce();
    connection.destroy();
    expect(destroyed).toHaveBeenCalledOnce();
    const second = bindExperiencePort(
      frame,
      {
        instanceId: 'j',
        buildDigest: 'a'.repeat(64),
        nonce: 'other',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {},
      } as never,
      receive,
      destroyed
    );
    channels[1].port1.onmessage?.({ data: { type: 'ready', nonce: 'forged' } });
    expect(receive).not.toHaveBeenCalled();
    expect(channels[1].port1.postMessage).not.toHaveBeenCalled();
    expect(destroyed).toHaveBeenCalledTimes(2);
    second.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('waits for a nonce-bound commit acknowledgement at the latest bootstrap epoch', () => {
  const channels: Array<{ port1: Port; port2: Port }> = [];
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'src', {
      set() {
        frame.dispatchEvent(new Event('load'));
      },
    });
    const ready = vi.fn();
    const destroyed = vi.fn();
    const connection = bindExperiencePort(
      frame,
      {
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
        nonce: 'bound',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {
          route: { epoch: 1 },
          catalog: { products: [], revision: '1' },
          capabilities: [],
        },
      } as never,
      vi.fn(),
      destroyed,
      ready
    );
    const port = channels[0].port1;
    port.onmessage?.({
      data: { type: 'ready', nonce: 'bound', readiness: 'react-commit/v1' },
    });
    expect(ready).not.toHaveBeenCalled();

    connection.send({
      type: 'bootstrap',
      bootstrap: {
        route: { epoch: 2 },
        catalog: { products: [], revision: '2' },
        capabilities: [],
      },
    });
    port.onmessage?.({
      data: { type: 'render-committed', nonce: 'bound', epoch: 1 },
    });
    expect(ready).not.toHaveBeenCalled();
    port.onmessage?.({
      data: { type: 'render-committed', nonce: 'bound', epoch: 2 },
    });
    port.onmessage?.({
      data: { type: 'render-committed', nonce: 'bound', epoch: 2 },
    });
    expect(ready).toHaveBeenCalledOnce();
    expect(destroyed).not.toHaveBeenCalled();
    connection.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('withdraws an opted-in frame on a forged commit acknowledgement', () => {
  const channels: Array<{ port1: Port; port2: Port }> = [];
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'src', {
      set() {
        frame.dispatchEvent(new Event('load'));
      },
    });
    const ready = vi.fn();
    const destroyed = vi.fn();
    bindExperiencePort(
      frame,
      {
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
        nonce: 'bound',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {
          route: { epoch: 1 },
          catalog: { products: [], revision: '1' },
          capabilities: [],
        },
      } as never,
      vi.fn(),
      destroyed,
      ready
    );
    const port = channels[0].port1;
    port.onmessage?.({
      data: { type: 'ready', nonce: 'bound', readiness: 'react-commit/v1' },
    });
    port.onmessage?.({
      data: { type: 'render-committed', nonce: 'forged', epoch: 1 },
    });
    expect(destroyed).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('withdraws an opted-in frame on the fixed hydration failure signal', () => {
  const channels: Array<{ port1: Port; port2: Port }> = [];
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'src', {
      set() {
        frame.dispatchEvent(new Event('load'));
      },
    });
    const ready = vi.fn();
    const destroyed = vi.fn();
    bindExperiencePort(
      frame,
      {
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
        nonce: 'bound',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {
          route: { epoch: 1 },
          catalog: { products: [], revision: '1' },
          capabilities: [],
        },
      } as never,
      vi.fn(),
      destroyed,
      ready
    );
    const port = channels[0].port1;
    port.onmessage?.({
      data: { type: 'ready', nonce: 'bound', readiness: 'react-commit/v1' },
    });
    port.onmessage?.({
      data: { type: 'render-failed', nonce: 'bound', code: 'HYDRATION_FAILED' },
    });
    expect(destroyed).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('fails a commit-opted-in frame on timeout and ignores late acknowledgements', async () => {
  vi.useFakeTimers();
  const channels: Array<{ port1: Port; port2: Port }> = [];
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      channels.push(this);
    }
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'src', {
      set() {
        frame.dispatchEvent(new Event('load'));
      },
    });
    const ready = vi.fn();
    const destroyed = vi.fn();
    bindExperiencePort(
      frame,
      {
        instanceId: 'i',
        buildDigest: 'a'.repeat(64),
        nonce: 'bound',
        src: 'http://127.0.0.1:4101/private',
        bootstrap: {
          route: { epoch: 1 },
          catalog: { products: [], revision: '1' },
          capabilities: [],
        },
      } as never,
      vi.fn(),
      destroyed,
      ready
    );
    const port = channels[0].port1;
    port.onmessage?.({
      data: { type: 'ready', nonce: 'bound', readiness: 'react-commit/v1' },
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(destroyed).toHaveBeenCalledOnce();
    port.onmessage?.({
      data: { type: 'render-committed', nonce: 'bound', epoch: 1 },
    });
    expect(ready).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
