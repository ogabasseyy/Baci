import type { RouteState } from '@baci/shared/experience';
import type { CartContextType } from '@/hooks/cart/cart-types';
import { asRoute } from '@/lib/routes';
import type { PublishedExperienceFrameHost } from './experience-frame-types';
import { resolveHostDestination } from './experience-host-destination';
import { createExperienceHostDispatcher } from './experience-host-dispatcher';
import {
  readExperiencePublicationState,
  renewExperienceLaunch,
} from './experience-launch-client';
import { createPublicationAdmission } from './experience-publication-watch';
import type { ExperienceShellController } from './experience-shell-controller';
export interface ExperienceHostLive {
  cart: CartContextType | null;
  router: { refresh(): void; push(href: ReturnType<typeof asRoute>): void };
}
export function createPublishedExperienceHost({
  controller,
  live,
  merchantSlug,
  present,
}: {
  controller: ExperienceShellController;
  live: { current: ExperienceHostLive };
  merchantSlug: string;
  present: () => void;
}) {
  let generation = 1;
  let recoveryRefreshPending = false;
  let partition = `document:${crypto.randomUUID()}`;
  let watch: ReturnType<typeof createPublicationAdmission> | null = null;
  let expiresAt = 0;
  let boundKey = '';
  let renewing: { key: string; promise: Promise<boolean> } | null = null;
  let watchedBuild = '';
  let watchedPolicy = '';
  let watchedCatalog = '';
  let watchedInstance = '';
  const current = () => {
    const s = controller.getSnapshot();
    if (!s) throw Error('NO_EXPERIENCE');
    return s;
  };
  const ensureWatch = () => {
    const s = current();
    if (
      watchedInstance !== s.data.launch.instanceId ||
      watchedBuild !== s.data.manifest.buildDigest ||
      watchedPolicy !== s.data.manifest.policyRevision ||
      watchedCatalog !== s.data.bootstrap.catalog.revision
    ) {
      watchedInstance = s.data.launch.instanceId;
      watchedBuild = s.data.manifest.buildDigest;
      watchedPolicy = s.data.manifest.policyRevision;
      watchedCatalog = s.data.bootstrap.catalog.revision;
      const key = JSON.stringify([
        watchedInstance,
        watchedBuild,
        watchedPolicy,
        watchedCatalog,
      ]);
      watch = createPublicationAdmission({
        policyRevision: watchedPolicy,
        catalogRevision: watchedCatalog,
        read: () => readExperiencePublicationState(current().data.stateUrl),
        withdraw: () => {
          const s = controller.getSnapshot();
          if (
            s &&
            JSON.stringify([
              s.data.launch.instanceId,
              s.data.manifest.buildDigest,
              s.data.manifest.policyRevision,
              s.data.bootstrap.catalog.revision,
            ]) === key
          ) {
            generation++;
            controller.withdraw();
            if (!recoveryRefreshPending) {
              recoveryRefreshPending = true;
              live.current.router.refresh();
            }
          }
        },
      });
    }
    return watch;
  };
  const ensureLaunch = async () => {
    const start = current();
    const key = start.data.launch.instanceId;
    if (boundKey === key && expiresAt - Date.now() > 60000) return true;
    if (renewing?.key === key) return renewing.promise;
    const promise: Promise<boolean> = Promise.resolve().then(async () => {
      try {
        const r = await renewExperienceLaunch(start.data.stateUrl);
        const now = current();
        if (
          !now.active ||
          now.data.launch.instanceId !== key ||
          r.buildDigest !== now.data.manifest.buildDigest ||
          r.policyRevision !== now.data.manifest.policyRevision ||
          r.catalogRevision !== now.data.bootstrap.catalog.revision ||
          r.expiresAt <= Date.now() ||
          r.expiresAt > Date.now() + 1801000
        )
          return false;
        expiresAt = r.expiresAt;
        boundKey = key;
        return true;
      } catch {
        return false;
      } finally {
        if (renewing?.promise === promise) renewing = null;
      }
    });
    renewing = { key, promise };
    return await promise;
  };
  const isActive = async () => {
    const start = controller.getSnapshot();
    if (!start?.active) return false;
    const instanceId = start.data.launch.instanceId;
    const isCurrent = () =>
      controller.getSnapshot()?.data.launch.instanceId === instanceId;
    try {
      const checker = ensureWatch();
      if (!(await checker?.check())) return false;
      if (!isCurrent()) return false;
      if (!(await ensureLaunch())) {
        if (isCurrent()) controller.withdraw();
        return false;
      }
      if (!isCurrent()) return false;
      recoveryRefreshPending = false;
      return current().active;
    } catch {
      if (isCurrent()) controller.withdraw();
      return false;
    }
  };
  let dispatch: ReturnType<typeof createExperienceHostDispatcher>;
  const host: PublishedExperienceFrameHost = {
    ready() {
      const state = current();
      controller.markReady(state.data.launch.instanceId);
    },
    failed() {
      void isActive().then((valid) =>
        valid ? controller.failFrame() : controller.withdraw()
      );
    },
    current() {
      const s = current();
      return {
        bootstrap: s.data.bootstrap,
        route: s.data.bootstrap.route,
        binding: {
          instanceId: s.data.launch.instanceId,
          buildDigest: s.data.manifest.buildDigest,
          shopperPartition: partition,
        },
        revision: s.data.manifest.policyRevision,
        generation,
        active:
          s.active &&
          boundKey === s.data.launch.instanceId &&
          Date.now() < expiresAt &&
          (watch?.active() ?? true),
        transition: s.transitioning,
      };
    },
    subscribe(listener) {
      return controller.subscribe(() => {
        const s = controller.getSnapshot();
        if (s) listener(s.data.bootstrap.route);
      });
    },
    async resolveNavigation(path) {
      return (
        await resolveHostDestination(current(), path, controller.getSnapshot)
      ).destination;
    },
    async navigate(requestedPath) {
      const s = current();
      const { destination, owned } = await resolveHostDestination(
        s,
        requestedPath,
        controller.getSnapshot
      );
      if (!owned) {
        // The native PDP has no experience boundary to acknowledge this transition.
        controller.exit();
        live.current.router.push(
          asRoute(
            new URL(
              s.data.launch.canonicalBase.replace(/\/$/, '') + destination
            ).pathname
          )
        );
        return {
          ...s.data.bootstrap.route,
          epoch: s.data.bootstrap.route.epoch + 1,
          canonicalPath: destination,
          routeId: 'product',
          params: { handle: destination.split('/').at(-1) ?? '' },
        };
      }
      if (s.data.bootstrap.route.canonicalPath === destination)
        return s.data.bootstrap.route;
      controller.beginTransition();
      const target =
        s.data.launch.canonicalBase.replace(/\/$/, '') + destination;
      return await new Promise<RouteState>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe();
          controller.withdraw();
          reject(Error('ROUTE_TIMEOUT'));
        }, 8000);
        const unsubscribe = controller.subscribe(() => {
          const next = controller.getSnapshot();
          if (next?.data.bootstrap.route.canonicalPath === destination) {
            clearTimeout(timer);
            unsubscribe();
            resolve(next.data.bootstrap.route);
          }
        });
        live.current.router.push(asRoute(new URL(target).pathname));
      });
    },
    dispatch: (request) => dispatch(request),
  };
  dispatch = createExperienceHostDispatcher({
    current,
    host,
    live,
    isActive,
    rebind: (verified) => {
      partition = verified;
    },
    merchantSlug,
    present,
  });
  return {
    host,
    isActive,
    withdraw: () => {
      watch?.withdraw();
      generation++;
      controller.withdraw();
    },
  };
}
