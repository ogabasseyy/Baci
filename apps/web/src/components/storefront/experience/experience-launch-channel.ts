import type { PublicBootstrap } from '@baci/shared/experience';
/** Listener is installed before src. Opaque execution origin intentionally requires '*'. */
export function bindExperiencePort(
  frame: HTMLIFrameElement,
  binding: {
    instanceId: string;
    buildDigest: string;
    nonce: string;
    src: string;
    bootstrap: PublicBootstrap;
  },
  receive: (data: unknown, port: MessagePort) => void,
  onDestroyed: () => void,
  onReady?: () => void
) {
  let loads = 0;
  let destroyed = false;
  let channel: MessageChannel | null = null;
  let connected = false;
  let commitRequired = false;
  let acknowledged = false;
  const initialEpoch = binding.bootstrap?.route?.epoch;
  let expectedEpoch = Number.isSafeInteger(initialEpoch) ? initialEpoch : -1;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(timer);
    frame.removeEventListener('load', load);
    channel?.port1.close();
    channel?.port2.close();
    onDestroyed();
  };
  const load = () => {
    if (++loads !== 1) return destroy();
    const own = new MessageChannel();
    channel = own;
    own.port1.onmessage = (e) => {
      if (destroyed) return;
      if (!connected) {
        if (e.data?.type !== 'ready' || e.data.nonce !== binding.nonce)
          return destroy();
        if (
          e.data.readiness !== undefined &&
          e.data.readiness !== 'react-commit/v1'
        )
          return destroy();
        connected = true;
        commitRequired = e.data.readiness === 'react-commit/v1';
        channel?.port1.postMessage({
          type: 'bootstrap',
          bootstrap: binding.bootstrap,
        });
        if (!commitRequired) {
          acknowledged = true;
          clearTimeout(timer);
          onReady?.();
        }
        return;
      }
      if (e.data?.type === 'render-committed') {
        if (!commitRequired) return destroy();
        if (e.data.nonce !== binding.nonce) return destroy();
        if (!Number.isSafeInteger(e.data.epoch)) return destroy();
        if (e.data.epoch < expectedEpoch) return;
        if (e.data.epoch !== expectedEpoch) return destroy();
        if (!acknowledged) {
          acknowledged = true;
          clearTimeout(timer);
          onReady?.();
        }
        return;
      }
      if (e.data?.type === 'render-failed') {
        if (
          !commitRequired ||
          e.data.nonce !== binding.nonce ||
          e.data.code !== 'HYDRATION_FAILED'
        )
          return destroy();
        return destroy();
      }
      receive(e.data, own.port1);
    };
    channel.port1.start();
    frame.contentWindow?.postMessage(
      {
        type: 'baci-experience-connect',
        nonce: binding.nonce,
        instanceId: binding.instanceId,
        buildDigest: binding.buildDigest,
      },
      '*',
      [channel.port2]
    );
  };
  const timer = setTimeout(destroy, 10000);
  frame.addEventListener('load', load);
  frame.src = binding.src;
  return {
    destroy,
    send(data: unknown) {
      if (!connected || destroyed) return;
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type === 'bootstrap' &&
        'bootstrap' in data &&
        data.bootstrap &&
        typeof data.bootstrap === 'object' &&
        'route' in data.bootstrap &&
        data.bootstrap.route &&
        typeof data.bootstrap.route === 'object' &&
        'epoch' in data.bootstrap.route &&
        Number.isSafeInteger(data.bootstrap.route.epoch)
      )
        expectedEpoch = data.bootstrap.route.epoch as number;
      else if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type === 'route' &&
        'route' in data &&
        data.route &&
        typeof data.route === 'object' &&
        'epoch' in data.route &&
        Number.isSafeInteger(data.route.epoch)
      )
        expectedEpoch = data.route.epoch as number;
      channel?.port1.postMessage(data);
    },
  };
}
