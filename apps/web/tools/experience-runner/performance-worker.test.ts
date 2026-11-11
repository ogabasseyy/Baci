import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import {
  performanceWorkerInput,
  performanceWorkerOutput,
} from '../../src/schemas/experience-performance-worker';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function input() {
  const javascript = 'export{}';
  return performanceWorkerInput.parse({
    mode: 'candidate-performance/v1',
    width: 390,
    bundle: {
      hostOrigin: 'http://127.0.0.1:4100',
      javascript,
      css: '',
      digest: digestBytes(`${javascript}\0`),
      imports: [],
    },
    bootstrap: {
      route: {
        epoch: 0,
        routeId: 'home',
        params: {},
        canonicalPath: '/',
        publicDataRevision: 'synthetic',
      },
      catalog: { products: [], revision: 'synthetic' },
      capabilities: ['catalog.read'],
    },
    assets: [],
  });
}

describe('performance worker subprocess', () => {
  it('validates stdin, runs the bounded browser orchestration, and emits the sample protocol', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'baci-performance-worker-'));
    tempDirs.push(dir);
    const outfile = path.join(dir, 'worker.mjs');
    await build({
      entryPoints: ['tools/experience-runner/performance-worker.ts'],
      outfile,
      absWorkingDir: process.cwd(),
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [
        {
          name: 'deterministic-worker-fixtures',
          setup(buildApi) {
            buildApi.onResolve(
              {
                filter:
                  /^(playwright-core|.*compiled-candidate|.*isolated-performance-collector|.*performance-harness)$/,
              },
              (args) => ({
                path: args.path,
                namespace: 'fixture',
              })
            );
            buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
              if (args.path === 'playwright-core')
                return {
                  contents: `export const chromium={launch:async()=>({version:()=>"Chromium fixture",newContext:async()=>({newPage:async()=>({on(){},goto:async()=>{},waitForTimeout:async()=>{}}),close:async()=>{}}),close:async()=>{}})};`,
                  loader: 'js',
                };
              if (args.path.endsWith('compiled-candidate'))
                return {
                  contents: 'export function verifyCompiledCandidate() {}',
                  loader: 'js',
                };
              if (args.path.endsWith('isolated-performance-collector'))
                return {
                  contents: `export async function installIsolatedPerformanceCollector(){return {read:async()=>({host:{timeOrigin:100,lcpMs:400,rawCls:0,cls:0,firstPaintMs:null,rawLayoutShifts:[],layoutShiftOverflow:false,viewport:{width:390,height:844}},frame:{timeOrigin:100,lcpMs:350,rawCls:0,cls:0,firstPaintMs:null,rawLayoutShifts:[],layoutShiftOverflow:false,viewport:{width:390,height:844}},contentVisible:true,imagesDecoded:true,contaminated:false}),close:async()=>{}}}`,
                  loader: 'js',
                };
              return {
                contents:
                  'export async function startPerformanceHarness(){return {origin:"http://127.0.0.1:4100",close:async()=>{},chromiumOptions:{},transport:"http-loopback",tlsConnections:()=>0,blockedRequests:()=>0}}',
                loader: 'js',
              };
            });
          },
        },
      ],
      logLevel: 'silent',
    });

    const stdout = execFileSync(process.execPath, [outfile], {
      cwd: process.cwd(),
      input: JSON.stringify(input()),
      encoding: 'utf8',
    });
    const result: unknown = JSON.parse(stdout.trim());
    expect(performanceWorkerOutput.parse(result)).toMatchObject({
      format: 'baci.performance-sample/v1',
      route: '/',
      width: 390,
      hostLcpMs: 400,
      frameLcpMs: 350,
      observationWindowMs: 2000,
    });

    expect(() =>
      execFileSync(process.execPath, [outfile], {
        cwd: process.cwd(),
        input: '{"mode":"candidate-performance/v1","width":393}',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    ).toThrow();
  });
});
