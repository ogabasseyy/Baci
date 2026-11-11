export { unpackPrivateBuild } from './private-build-payload';

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ExperienceManifest } from '@baci/shared/experience';
import { build } from 'esbuild';
import { productionOrigin } from '../../src/lib/experience/production-origins';
import { parseExperienceManifest } from '../../src/schemas/experience-manifest';
import { AUTHORED_PACKAGES, PACKAGE_CATALOG } from './package-catalog';
import {
  hydrationRuntimeEntry,
  prerenderRuntimeEntry,
} from './prerender-runtime-entry';
import { localPreviewHost } from './preview-origin';

const appRoot = path.resolve(import.meta.dirname, '../..');
function packageInfo(filename: string): { name: string; version: string } {
  let dir = path.dirname(realpathSync(filename));
  while (dir !== path.dirname(dir)) {
    try {
      return JSON.parse(
        readFileSync(path.join(dir, 'package.json'), 'utf8')
      ) as { name: string; version: string };
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('Unowned package file');
}
/** Compiler only. Never evaluate, import, SSR or run candidate modules here. */
export async function bundleSource(
  input: ExperienceManifest,
  options: {
    profile?: 'production';
    previewOrigin?: string;
    mountComponent?: boolean;
    hostOrigin?: string;
    renderMode?: 'prerender' | 'hydrate';
  } = {}
) {
  const validateOrigin =
    options.profile === 'production' ? productionOrigin : localPreviewHost;
  if (options.previewOrigin && options.profile !== 'production')
    throw Error('Invalid preview origin');
  const previewOrigin = options.previewOrigin
    ? productionOrigin(options.previewOrigin)
    : undefined;
  const manifest = parseExperienceManifest(input);
  for (const p of manifest.packages) {
    if (!(AUTHORED_PACKAGES as readonly string[]).includes(p.name))
      throw new Error('Unsupported package');
  }
  const files = new Map(manifest.files.map((f) => [f.path, f.content]));
  let entry = manifest.entry;
  if (options.renderMode && options.mountComponent)
    throw Error('Conflicting runtime entries');
  if (options.renderMode) {
    entry =
      options.renderMode === 'prerender'
        ? '__baci_prerender__.tsx'
        : '__baci_hydrate__.tsx';
    if (files.has(entry)) throw Error('Reserved runtime entry');
    files.set(
      entry,
      options.renderMode === 'prerender'
        ? prerenderRuntimeEntry(manifest.entry)
        : hydrationRuntimeEntry(
            manifest.entry,
            validateOrigin(options.hostOrigin ?? 'http://127.0.0.1:4100'),
            previewOrigin
          )
    );
  }
  if (options.mountComponent) {
    const hostOrigin = validateOrigin(
      options.hostOrigin ?? 'http://127.0.0.1:4100'
    );
    entry = '__baci_runtime__.tsx';
    if (files.has(entry)) throw Error('Reserved runtime entry');
    files.set(
      entry,
      `import {useState,useEffect,useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';import {connectExperience,CommerceProvider} from '@baci/experience-sdk';import Experience from './${manifest.entry}';const root=document.getElementById('root');root.inert=true;const bridge=connectExperience(${JSON.stringify(hostOrigin)},${JSON.stringify({ readiness: 'react-commit/v1', ...(previewOrigin ? { previewOrigin } : {}) })});let renderFailed=false;function failRender(){renderFailed=true;root.inert=true;document.documentElement.dataset.baciHydration='failed';bridge.failRenderCommit()}function Runtime(){const[data,setData]=useState(null);const[bridgeReady,setBridgeReady]=useState(false);useEffect(()=>{let active=true;bridge.ready.then(value=>{if(active){setData(value);setBridgeReady(true)}});const off=bridge.onBootstrap(value=>{if(active){setData(value);setBridgeReady(true)}});const offRoute=bridge.onRoute(route=>{if(active)setData(current=>({...current,route}))});return()=>{active=false;off();offRoute()}},[]);useLayoutEffect(()=>{if(!bridgeReady||!data||renderFailed)return;if(bridge.acknowledgeRenderCommit(data.route.epoch)){root.inert=false;document.documentElement.dataset.baciHydration='ready'}},[data,bridgeReady]);if(!data)return null;return <CommerceProvider commerce={bridge.commerce} assets={data.assets??{}}><Experience route={data.route} catalog={data.catalog}/></CommerceProvider>}createRoot(root,{onRecoverableError:failRender,onUncaughtError:failRender}).render(<Runtime/>);`
    );
  }
  const packageNames = new Set(manifest.packages.map((p) => p.name));
  if (options.mountComponent || options.renderMode) {
    packageNames.add('react-dom');
    packageNames.add('@baci/experience-sdk');
  }
  packageNames.add('react'); // Automatic JSX runtime, pinned by platform.
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: appRoot,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    write: false,
    outdir: 'out',
    metafile: true,
    minify: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'closed-source-graph',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.pluginData?.platformResolution) return;
            if (args.kind === 'entry-point')
              return { path: args.path, namespace: 'source' };
            if (args.namespace === 'source' && args.path.startsWith('.')) {
              const base = path.posix.normalize(
                path.posix.join(path.posix.dirname(args.importer), args.path)
              );
              const found = [
                base,
                ...[
                  '.tsx',
                  '.ts',
                  '.jsx',
                  '.js',
                  '.css',
                  '/index.tsx',
                  '/index.ts',
                ].map((ext) => base + ext),
              ].find((p) => files.has(p));
              if (!found || base.startsWith('../'))
                throw new Error('Missing or escaping source import');
              return { path: found, namespace: 'source' };
            }
            if (
              args.kind === 'url-token' &&
              manifest.assets.some(
                (asset) => args.path === `/assets/${asset.assetId}`
              )
            )
              return { path: args.path, external: true };
            if (
              args.path.startsWith('/') ||
              args.path.includes(':') ||
              args.path.includes('\\')
            )
              throw new Error('External/host import denied');
            if (args.namespace === 'source') {
              const root = args.path.startsWith('@')
                ? args.path.split('/').slice(0, 2).join('/')
                : args.path.split('/')[0];
              if (!packageNames.has(root))
                throw new Error('Undeclared package');
            }
            return b.resolve(args.path, {
              resolveDir: args.resolveDir || appRoot,
              kind: args.kind,
              pluginData: { platformResolution: true },
            });
          });
          b.onLoad({ filter: /.*/, namespace: 'source' }, (args) => {
            const contents = files.get(args.path);
            if (contents === undefined) throw new Error('Missing source file');
            const ext = path.posix.extname(args.path).slice(1);
            if (!['tsx', 'ts', 'jsx', 'js', 'css'].includes(ext))
              throw new Error('Unsupported source file');
            return {
              contents,
              loader: ext as 'tsx' | 'ts' | 'jsx' | 'js' | 'css',
              resolveDir: appRoot,
            };
          });
          b.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
            const info = packageInfo(args.path);
            if (PACKAGE_CATALOG[info.name] !== info.version)
              throw new Error(`Unqualified package: ${info.name}`);
            return undefined;
          });
        },
      },
    ],
  });
  const javascript =
    result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
  const css =
    result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  if (!javascript || Buffer.byteLength(javascript + css) > 16 * 1024 * 1024)
    throw new Error('Invalid compiled output budget');
  return {
    ...(options.mountComponent || options.renderMode === 'hydrate'
      ? {
          hostOrigin: validateOrigin(
            options.hostOrigin ?? 'http://127.0.0.1:4100'
          ),
        }
      : {}),
    javascript,
    css,
    digest: createHash('sha256')
      .update(javascript)
      .update('\0')
      .update(css)
      .digest('hex'),
    imports: Object.keys(result.metafile.inputs),
  };
}
