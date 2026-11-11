import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(
  () =>
    [] as Array<{
      expire: () => void;
      binding: unknown;
      ready: () => void;
      receive: (data: unknown, port: MessagePort) => void;
      send: ReturnType<typeof vi.fn>;
    }>
);
vi.mock('./experience-launch-channel', () => ({
  bindExperiencePort: (
    _frame: unknown,
    _binding: unknown,
    _receive: (data: unknown, port: MessagePort) => void,
    expire: () => void,
    ready: () => void
  ) => {
    const send = vi.fn();
    bindings.push({
      expire,
      binding: _binding,
      ready,
      receive: _receive,
      send,
    });
    return { destroy: expire, send };
  },
}));

import { ExperienceFrame } from './ExperienceFrame';
import type { ExperienceFrameLaunch } from './experience-frame-types';

afterEach(() => vi.useRealTimers());

function publishedHost(
  launch: ExperienceFrameLaunch,
  active: () => boolean,
  failed = vi.fn()
) {
  return {
    current: () => ({
      bootstrap: launch.bootstrap,
      route: launch.bootstrap.route,
      binding: {
        instanceId: launch.instanceId,
        buildDigest: launch.buildDigest,
        shopperPartition: 'document',
      },
      revision: 'r',
      generation: 1,
      active: active(),
      transition: false,
    }),
    dispatch: vi.fn(),
    navigate: vi.fn(),
    resolveNavigation: vi.fn(async (path: string) => path),
    subscribe: () => () => {},
    failed,
  };
}

it('StrictMode cleanup is silent and a fresh launch recovers after real expiration', () => {
  const launch: ExperienceFrameLaunch = {
    instanceId: 'first',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'http://127.0.0.1:4101/private',
    expiresAt: Date.now() + 600000,
    canonicalBase: window.location.origin,
    bootstrap: {
      catalog: { products: [], revision: '1' },
      capabilities: [],
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: '1',
      },
    },
    routes: [{ path: '/', view: 'home' }],
  };
  const active = async () => true;
  const view = render(
    <StrictMode>
      <ExperienceFrame launch={launch} isActive={active} />
    </StrictMode>
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTitle('Private full-code experience')).toBeTruthy();
  act(() => bindings.at(-1)?.expire());
  expect(screen.getByRole('alert')).toBeTruthy();
  view.rerender(
    <StrictMode>
      <ExperienceFrame
        launch={{ ...launch, instanceId: 'second', nonce: 'next' }}
        isActive={active}
      />
    </StrictMode>
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTitle('Private full-code experience')).toBeTruthy();
});
it('uses trusted published dispatch without adding a mock commerce controller', () => {
  const route = {
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: 'r',
  };
  const launch: ExperienceFrameLaunch = {
    instanceId: 'public',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'http://127.0.0.1:4101/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: window.location.origin,
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route,
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  const fresh = { ...launch.bootstrap, route: { ...route, epoch: 4 } };
  const host = {
    current: () => ({
      bootstrap: fresh,
      route: fresh.route,
      binding: {
        instanceId: 'public',
        buildDigest: launch.buildDigest,
        shopperPartition: 'document',
      },
      revision: 'r',
      generation: 1,
      active: true,
      transition: false,
    }),
    dispatch: vi.fn(),
    navigate: vi.fn(),
    resolveNavigation: vi.fn(async (path: string) => path),
    subscribe: () => () => {},
  };
  render(
    <ExperienceFrame launch={launch} isActive={async () => true} host={host} />
  );
  expect(screen.getByTitle('Storefront experience')).toBeTruthy();
  expect(screen.queryByText('Private preview · synthetic commerce')).toBeNull();
  expect(bindings.at(-1)?.binding).toMatchObject({
    bootstrap: { route: { epoch: 4 } },
  });
});

it('keeps a preloaded published frame hidden until admitted and bridge-ready', () => {
  const launch: ExperienceFrameLaunch = {
    instanceId: 'preloaded',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'https://store.example/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: 'https://store.example',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  const ready = vi.fn();
  const failed = vi.fn();
  const host = {
    current: () => ({
      bootstrap: launch.bootstrap,
      route: launch.bootstrap.route,
      binding: {
        instanceId: launch.instanceId,
        buildDigest: launch.buildDigest,
        shopperPartition: 'document',
      },
      revision: 'r',
      generation: 1,
      active: true,
      transition: false,
    }),
    dispatch: vi.fn(),
    navigate: vi.fn(),
    resolveNavigation: vi.fn(async (path: string) => path),
    subscribe: () => () => {},
    ready,
    failed,
  };
  const view = render(
    <ExperienceFrame
      launch={launch}
      isActive={async () => true}
      host={host}
      admitted={false}
      presented={false}
    />
  );
  const section = screen.getByTitle('Storefront experience').parentElement;
  expect(section).toHaveAttribute('aria-hidden', 'true');
  expect(section).toHaveAttribute('inert');
  act(() => bindings.at(-1)?.ready());
  expect(ready).not.toHaveBeenCalled();
  expect(section).toHaveAttribute('aria-hidden', 'true');

  view.rerender(
    <ExperienceFrame
      launch={launch}
      isActive={async () => true}
      host={host}
      admitted
      presented={false}
    />
  );
  expect(ready).toHaveBeenCalledTimes(1);
  expect(section).toHaveAttribute('aria-hidden', 'true');
  expect(section).toHaveAttribute('inert');

  view.rerender(
    <ExperienceFrame
      launch={launch}
      isActive={async () => true}
      host={host}
      admitted
      presented
    />
  );
  expect(section).not.toHaveAttribute('aria-hidden', 'true');
  act(() => bindings.at(-1)?.expire());
  expect(failed).toHaveBeenCalledTimes(1);
  expect(section).toHaveAttribute('aria-hidden', 'true');
  expect(section).toHaveAttribute('inert');
});

it('keeps the channel during bounded initial host binding and survives a valid renewal', async () => {
  vi.useFakeTimers();
  const launch: ExperienceFrameLaunch = {
    instanceId: 'initial-binding',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'https://store.example/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: 'https://store.example',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  let resolveActive: (value: boolean) => void = () => {};
  const isActive = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveActive = resolve;
      })
  );
  const hostActive = { value: false };
  render(
    <ExperienceFrame
      launch={launch}
      isActive={isActive}
      host={publishedHost(launch, () => hostActive.value)}
      admitted={false}
      presented={false}
    />
  );

  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(isActive).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();

  hostActive.value = true;
  await act(async () => resolveActive(true));
  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('destroys an initial host channel immediately when admission is denied', async () => {
  vi.useFakeTimers();
  const launch: ExperienceFrameLaunch = {
    instanceId: 'denied-binding',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'https://store.example/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: 'https://store.example',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  const isActive = vi.fn(async () => false);
  render(
    <ExperienceFrame
      launch={launch}
      isActive={isActive}
      host={publishedHost(launch, () => false)}
      admitted={false}
      presented={false}
    />
  );

  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(isActive).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
    'Custom storefront unavailable. Continue in the native store.'
  );
});

it('expires an initial host binding that remains unresolved at its bounded deadline', async () => {
  vi.useFakeTimers();
  const launch: ExperienceFrameLaunch = {
    instanceId: 'stalled-binding',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'https://store.example/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: 'https://store.example',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  const isActive = vi.fn(() => new Promise<boolean>(() => {}));
  render(
    <ExperienceFrame
      launch={launch}
      isActive={isActive}
      host={publishedHost(launch, () => false)}
      admitted={false}
      presented={false}
    />
  );

  await act(async () => {
    vi.advanceTimersByTime(9000);
    await Promise.resolve();
  });
  expect(isActive).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
    'Custom storefront unavailable. Continue in the native store.'
  );
});

it('destroys an already-admitted channel immediately when the host is revoked', async () => {
  vi.useFakeTimers();
  const launch: ExperienceFrameLaunch = {
    instanceId: 'revoked-host',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'https://store.example/public',
    expiresAt: Date.now() + 600000,
    canonicalBase: 'https://store.example',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { products: [], revision: 'r' },
      capabilities: [],
    },
  };
  const hostActive = { value: true };
  const failed = vi.fn();
  render(
    <ExperienceFrame
      launch={launch}
      isActive={async () => true}
      host={publishedHost(launch, () => hostActive.value, failed)}
    />
  );
  hostActive.value = false;

  await act(async () => {
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
  });

  expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
    'Custom storefront unavailable. Continue in the native store.'
  );
  expect(failed).toHaveBeenCalledOnce();
});

it('expires a private preview at its launch deadline', async () => {
  vi.useFakeTimers();
  const launch: ExperienceFrameLaunch = {
    instanceId: 'expired-preview',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'http://127.0.0.1:4101/private',
    expiresAt: Date.now() + 1500,
    canonicalBase: window.location.origin,
    bootstrap: {
      catalog: { products: [], revision: '1' },
      capabilities: [],
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: '1',
      },
    },
    routes: [{ path: '/', view: 'home' }],
  };
  render(<ExperienceFrame launch={launch} isActive={async () => true} />);

  await act(async () => {
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
  });

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Preview expired. Create a fresh owner launch.'
  );
});

it('sends SDK navigation results through epoch-tracking channel.send', async () => {
  const route = {
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: 'r',
  };
  const launch: ExperienceFrameLaunch = {
    instanceId: 'sdk-nav',
    nonce: 'n',
    buildDigest: 'a'.repeat(64),
    src: 'http://127.0.0.1:4101/private',
    expiresAt: Date.now() + 600000,
    canonicalBase: window.location.origin,
    bootstrap: {
      route,
      catalog: { revision: 'r', products: [] },
      capabilities: ['navigation'],
    },
    routes: [
      { path: '/', view: 'home' },
      { path: '/pages/story', view: 'editorial' },
    ],
  };
  render(<ExperienceFrame launch={launch} isActive={async () => true} />);
  const binding = bindings.at(-1);
  if (!binding) throw Error('No channel');
  const postMessage = vi.fn();
  await act(async () => {
    binding.receive(
      {
        protocol: 'baci-commerce/1',
        requestId: 'nav',
        instanceId: 'sdk-nav',
        buildDigest: launch.buildDigest,
        routeEpoch: 1,
        capability: 'navigation',
        method: 'navigation.go',
        args: { path: '/pages/story' },
      },
      { postMessage } as unknown as MessagePort
    );
  });
  expect(binding.send).toHaveBeenCalledWith({
    type: 'route',
    route: expect.objectContaining({ epoch: 2, canonicalPath: '/pages/story' }),
  });
});
