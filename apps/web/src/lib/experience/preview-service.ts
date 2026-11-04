import { randomBytes } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { digestBytes } from './manifest-digest';
export interface PreviewFile {
  path: string;
  mime: string;
  bytes: Uint8Array;
  digest: string;
}
export interface PreviewInput {
  ownerId: string;
  merchantId?: string;
  bindingId: string;
  buildDigest: string;
  files: PreviewFile[];
}
const safePath = (p: string) =>
  /^(index\.html|app\.(js|css)|assets\/[a-z0-9-]{1,80})$/.test(p);
/** Private output-only vault. No owner client/credentials are retained across requests. */
export function createPreviewVault(deps: {
  now: () => number;
  isActive: (bindingId: string) => Promise<boolean>;
  origin: string;
}) {
  const origin = new URL(deps.origin);
  if (
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw Error('INVALID_REQUEST');
  const launches = new Map<string, PreviewInput & { expiresAt: number }>();
  const resources = new Map<
    string,
    { bindingId: string; scope: string; expiresAt: number; file: PreviewFile }
  >();
  const sweep = () => {
    const now = deps.now();
    for (const [id, v] of launches) if (v.expiresAt <= now) launches.delete(id);
    for (const [id, v] of resources)
      if (v.expiresAt <= now) resources.delete(id);
  };
  const scopeOf = (input: PreviewInput) =>
    input.merchantId
      ? `merchant:${input.merchantId}`
      : `owner:${input.ownerId}`;
  const checkQuota = (scope: string, delta: number, resourceDelta = 0) => {
    let scopedResources = resourceDelta;
    let total = delta;
    let scoped = delta;
    for (const launch of launches.values()) {
      const bytes = launch.files.reduce((n, f) => n + f.bytes.length, 0);
      total += bytes;
      if (scopeOf(launch) === scope) scoped += bytes;
    }
    for (const resource of resources.values()) {
      total += resource.file.bytes.length;
      if (resource.scope === scope) {
        scoped += resource.file.bytes.length;
        scopedResources++;
      }
    }
    if (
      total > 67108864 ||
      scoped > 33554432 ||
      resources.size + resourceDelta > 8192 ||
      scopedResources > 2048
    )
      throw Error('QUOTA_EXCEEDED');
  };
  return {
    origin: origin.origin,
    create(input: PreviewInput) {
      sweep();
      const scope = scopeOf(input);
      const scopedLaunches = [...launches.values()].filter(
        (l) => scopeOf(l) === scope
      );
      // Consuming a one-use reference does not retire its live resource lease.
      const bindings = new Map<string, string>();
      for (const launch of launches.values())
        bindings.set(`${scopeOf(launch)}:${launch.bindingId}`, scopeOf(launch));
      for (const resource of resources.values())
        bindings.set(`${resource.scope}:${resource.bindingId}`, resource.scope);
      const newBinding = !bindings.has(`${scope}:${input.bindingId}`);
      const scopedBindings = [...bindings.values()].filter(
        (value) => value === scope
      ).length;
      if (
        launches.size >= 32 ||
        (newBinding && bindings.size >= 32) ||
        (newBinding && scopedBindings >= 8) ||
        scopedLaunches.length >= 8 ||
        input.files.length > 34 ||
        input.files.reduce((n, f) => n + f.bytes.length, 0) > 20971520
      )
        throw Error('QUOTA_EXCEEDED');
      checkQuota(
        scope,
        input.files.reduce((n, f) => n + f.bytes.length, 0)
      );
      for (const f of input.files)
        if (
          f.path === 'index.html' ||
          !safePath(f.path) ||
          digestBytes(f.bytes) !== f.digest
        )
          throw Error('BUILD_FAILED');
      const ref = randomBytes(32).toString('hex');
      launches.set(ref, {
        ...structuredClone(input),
        expiresAt: deps.now() + 600000,
      });
      return ref;
    },
    consume(ownerId: string, ref: string) {
      const launch = launches.get(ref);
      if (!launch || launch.expiresAt <= deps.now())
        throw Error('LAUNCH_EXPIRED');
      if (ownerId !== launch.ownerId) throw Error('NOT_FOUND');
      launches.delete(ref);
      const scope = scopeOf(launch);
      const pending: typeof resources = new Map();
      const listed = launch.files.map((file) => {
        const ticket = randomBytes(32).toString('hex');
        pending.set(ticket, {
          bindingId: launch.bindingId,
          scope,
          expiresAt: launch.expiresAt,
          file,
        });
        return {
          path: file.path,
          digest: file.digest,
          mime: file.mime,
          ticket,
          url: `${origin.origin}/resource/${ticket}/${file.path}`,
        };
      });
      const css = listed.find((f) => f.path === 'app.css');
      if (css) {
        const resource = pending.get(css.ticket);
        if (!resource) throw Error('BUILD_FAILED');
        const urls = new Map<string, string>(
          listed
            .filter((f) => f.path.startsWith('assets/'))
            .map((asset) => [`/${asset.path}`, asset.url])
        );
        const text = Buffer.from(resource.file.bytes)
          .toString('utf8')
          .replace(/\/assets\/[^"'()\s]+/g, (path) => urls.get(path) ?? path);
        resource.file = {
          ...resource.file,
          bytes: Buffer.from(text),
          digest: digestBytes(text),
        };
        css.digest = resource.file.digest;
      }
      const js = listed.find((f) => f.path === 'app.js');
      if (!js) throw Error('BUILD_FAILED');
      const html =
        '<!doctype html>' +
        renderToStaticMarkup(
          createElement(
            'html',
            null,
            createElement(
              'head',
              null,
              createElement('meta', {
                name: 'viewport',
                content: 'width=device-width,initial-scale=1',
              }),
              createElement('meta', {
                name: 'robots',
                content: 'noindex,nofollow',
              }),
              css
                ? createElement('link', { rel: 'stylesheet', href: css.url })
                : null
            ),
            createElement(
              'body',
              null,
              createElement('div', { id: 'root' }),
              createElement('script', { type: 'module', src: js.url })
            )
          )
        );
      const ticket = randomBytes(32).toString('hex');
      pending.set(ticket, {
        bindingId: launch.bindingId,
        scope,
        expiresAt: launch.expiresAt,
        file: {
          path: 'index.html',
          mime: 'text/html',
          bytes: Buffer.from(html),
          digest: digestBytes(html),
        },
      });
      checkQuota(
        scope,
        [...pending.values()].reduce((n, r) => n + r.file.bytes.length, 0),
        pending.size
      );
      for (const [id, resource] of pending) resources.set(id, resource);
      return {
        buildDigest: launch.buildDigest,
        bindingId: launch.bindingId,
        expiresAt: launch.expiresAt,
        resources: listed,
        src: `${origin.origin}/resource/${ticket}/index.html`,
      };
    },

    async consumePrerender(
      ownerId: string,
      ref: string,
      render: (
        resources: Array<{ path: string; url: string; digest: string }>
      ) => Promise<string>
    ) {
      const launch = this.consume(ownerId, ref);
      try {
        const html = await render(launch.resources);
        const bytes = Buffer.from(html);
        if (bytes.length > 4194304) throw Error('QUOTA_EXCEEDED');
        if (
          launch.expiresAt <= deps.now() ||
          !(await deps.isActive(launch.bindingId)) ||
          launch.expiresAt <= deps.now() ||
          !launch.resources.every((r) => resources.has(r.ticket))
        )
          throw Error('LAUNCH_EXPIRED');
        const originalTicket = new URL(launch.src).pathname.split('/')[2];
        const original = resources.get(originalTicket);
        if (!original) throw Error('LAUNCH_EXPIRED');
        // Check after all awaits; replacing HTML charges only the byte delta.
        sweep();
        checkQuota(original.scope, bytes.length - original.file.bytes.length);
        resources.delete(originalTicket);
        const ticket = randomBytes(32).toString('hex');
        resources.set(ticket, {
          bindingId: launch.bindingId,
          scope: original.scope,
          expiresAt: launch.expiresAt,
          file: {
            path: 'index.html',
            mime: 'text/html',
            bytes,
            digest: digestBytes(bytes),
          },
        });
        return {
          ...launch,
          src: `${origin.origin}/resource/${ticket}/index.html`,
        };
      } catch (error) {
        this.revoke(launch.bindingId);
        throw error;
      }
    },

    async read(ticket: string, path: string) {
      const r = resources.get(ticket);
      if (!r || !safePath(path) || r.file.path !== path)
        throw Error('NOT_FOUND');
      if (
        r.expiresAt <= deps.now() ||
        !(await deps.isActive(r.bindingId)) ||
        resources.get(ticket) !== r ||
        r.expiresAt <= deps.now()
      )
        throw Error('LAUNCH_EXPIRED');
      if (digestBytes(r.file.bytes) !== r.file.digest)
        throw Error('BUILD_FAILED');
      return { ...r.file, bytes: r.file.bytes.slice() };
    },
    revoke(bindingId: string) {
      for (const [k, r] of resources)
        if (r.bindingId === bindingId) resources.delete(k);
      for (const [k, r] of launches)
        if (r.bindingId === bindingId) launches.delete(k);
    },
  };
}
export type PreviewVault = ReturnType<typeof createPreviewVault>;
