'use client';
import type {
  BridgeResult,
  CartBridgeResult,
  PortBinding,
} from '@baci/shared/experience';
import { useEffect, useRef, useState } from 'react';
import { ExperienceNavigationPresentation } from './ExperienceNavigationPresentation';
import { ExperiencePreviewNavigation } from './ExperiencePreviewNavigation';
import type { AdmissionStamp } from './experience-admission';
import { admitExperienceEffect } from './experience-admission';
import { createFrameActivity } from './experience-frame-activity';
import { createFrameDispatcher } from './experience-frame-dispatcher';
import type { ExperienceFrameProps } from './experience-frame-types';
import { bindExperiencePort } from './experience-launch-channel';
import type { PresentedCanonicalLink } from './experience-navigation-open';
import { createNavigationPresentation } from './experience-navigation-open';
import { createExperiencePort } from './experience-port';
import { createRouteCoordinator } from './experience-route-coordinator';

export type { ExperienceFrameLaunch } from './experience-frame-types';
export function ExperienceFrame({
  launch,
  isActive,
  host,
  admitted = true,
  presented = true,
}: ExperienceFrameProps) {
  const [connectedInstance, setConnectedInstance] = useState<string | null>(
    null
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const [expiredInstance, setExpiredInstance] = useState<string | null>(null);
  const error = expiredInstance === launch.instanceId;
  const readyInstance = useRef<string | null>(null);
  const [link, setLink] = useState<PresentedCanonicalLink | null>(null);
  const sameTab = useRef<((href: string) => void) | null>(null);
  const navigation = useRef<ReturnType<
    typeof createNavigationPresentation
  > | null>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let active = true;
    let generation = 1;
    const routes = createRouteCoordinator(launch.bootstrap.route);
    const binding: PortBinding = {
      instanceId: launch.instanceId,
      buildDigest: launch.buildDigest,
      shopperPartition: `preview-${launch.instanceId}`,
    };
    const currentRoute = () => host?.current().route ?? routes.current();
    const state = (): AdmissionStamp => ({
      ...binding,
      epoch: routes.current().epoch,
      revision: 'private-preview',
      generation,
      transition: routes.isTransitioning(),
      active: active && Date.now() < launch.expiresAt,
      mode: host ? 'published' : 'private-preview',
      ...(host
        ? {
            ...host.current().binding,
            epoch: currentRoute().epoch,
            revision: host.current().revision,
            generation: host.current().generation,
            active: active && host.current().active,
            transition: host.current().transition,
          }
        : {}),
    });
    const nav = createNavigationPresentation({
      base: launch.canonicalBase,
      routes: [
        ...launch.routes.map((r) => r.path),
        ...(host
          ?.current()
          .bootstrap?.catalog.products.flatMap((p) =>
            p.canonicalPath ? [p.canonicalPath] : []
          ) ?? []),
      ],
      state: () => ({ ...state() }),
      now: Date.now,
    });
    navigation.current = nav;
    const previewDispatch = createFrameDispatcher({
      host,
      launch,
      nav,
      setLink,
      routes,
    });
    const dispatcher = createExperiencePort(
      binding,
      currentRoute,
      async (request) => {
        if (!launch.bootstrap.capabilities.includes(request.capability))
          return {
            status: 'error',
            code: 'INSUFFICIENT_SCOPE',
            message: 'Capability unavailable.',
          };
        let result:
          | Promise<BridgeResult<unknown> | CartBridgeResult>
          | undefined;
        const admitted = await admitExperienceEffect(
          state(),
          state,
          isActive,
          () => {
            result = previewDispatch(request);
          }
        );
        return admitted && result
          ? result
          : {
              status: 'error',
              code: 'STALE_ROUTE',
              message: 'Preview state changed.',
            };
      }
    );
    const channel = bindExperiencePort(
      element,
      { ...launch, bootstrap: host?.current().bootstrap ?? launch.bootstrap },
      (data, port) => {
        if (
          data &&
          typeof data === 'object' &&
          'type' in data &&
          data.type === 'route-ack'
        )
          return;
        void dispatcher.receive(data).then((result) => {
          if (!active) return;
          if (
            result.status === 'ok' &&
            data &&
            typeof data === 'object' &&
            'method' in data &&
            data.method === 'navigation.go'
          )
            channel.send({ type: 'route', route: result.value });
          const requestId =
            data && typeof data === 'object' && 'requestId' in data
              ? data.requestId
              : '';
          port.postMessage({ type: 'result', requestId, result });
        });
      },
      () => {
        if (!active) return;
        active = false;
        generation++;
        dispatcher.destroy();
        routes.destroy();
        setLink(null);
        setConnectedInstance(null);
        setExpiredInstance(launch.instanceId);
        host?.failed?.();
        element.removeAttribute('src');
      },
      () => {
        if (active) setConnectedInstance(launch.instanceId);
      }
    );
    const unsubscribe = host?.subscribe((route) => {
      const bootstrap = host.current().bootstrap;
      channel.send(
        bootstrap ? { type: 'bootstrap', bootstrap } : { type: 'route', route }
      );
    });
    sameTab.current = (href: string) => {
      nav.cancel();
      setLink(null);
      const path = href.slice(launch.canonicalBase.replace(/\/$/, '').length);
      void dispatcher
        .receive({
          protocol: 'baci-commerce/1',
          instanceId: binding.instanceId,
          buildDigest: binding.buildDigest,
          routeEpoch: currentRoute().epoch,
          requestId: crypto.randomUUID(),
          capability: 'navigation',
          method: 'navigation.go',
          args: { path },
        })
        .then((result) => {
          if (active && result.status === 'ok')
            channel.send({ type: 'route', route: result.value });
        });
    };
    const activity = createFrameActivity({
      host: !!host,
      hostActive: () => host?.current().active ?? false,
      isActive,
      expiresAt: launch.expiresAt,
      onInactive: () => channel.destroy(),
    });
    const timer = setInterval(() => {
      if (!active) return;
      activity();
      if (state().active && nav.current() === null) setLink(null);
    }, 1000);
    return () => {
      active = false;
      generation++;
      clearInterval(timer);
      unsubscribe?.();
      dispatcher.destroy();
      routes.destroy();
      channel.destroy();
      navigation.current = null;
      sameTab.current = null;
    };
  }, [launch, isActive, host]);
  useEffect(() => {
    if (
      host &&
      admitted &&
      connectedInstance === launch.instanceId &&
      readyInstance.current !== launch.instanceId
    ) {
      readyInstance.current = launch.instanceId;
      host.ready?.();
    }
  }, [admitted, connectedInstance, host, launch.instanceId]);
  const hidden =
    !!host &&
    (!admitted ||
      !presented ||
      connectedInstance !== launch.instanceId ||
      error);
  return (
    <section
      style={
        hidden
          ? {
              position: 'absolute',
              visibility: 'hidden',
              pointerEvents: 'none',
              width: '100%',
            }
          : undefined
      }
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      {!host && <p>Private preview · synthetic commerce</p>}
      {!host && (
        <ExperiencePreviewNavigation
          canonicalBase={launch.canonicalBase}
          routes={launch.routes}
          onNavigate={(href) => sameTab.current?.(href)}
        />
      )}
      {error ? (
        <p role="alert">
          {host
            ? 'Custom storefront unavailable. Continue in the native store.'
            : 'Preview expired. Create a fresh owner launch.'}
        </p>
      ) : (
        <iframe
          ref={frame}
          data-baci-experience-build={launch.buildDigest}
          title={
            host ? 'Storefront experience' : 'Private full-code experience'
          }
          sandbox="allow-scripts"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
          referrerPolicy="no-referrer"
          style={{
            display: 'block',
            width: '100%',
            height: host ? '100svh' : '85vh',
            border: 0,
          }}
        />
      )}
      <ExperienceNavigationPresentation
        link={link}
        onCancel={() => {
          navigation.current?.cancel();
          setLink(null);
        }}
        onSameTab={(href) => sameTab.current?.(href)}
      />
    </section>
  );
}
