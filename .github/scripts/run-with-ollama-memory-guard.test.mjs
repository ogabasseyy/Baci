import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  releaseResidentModels,
  runGuardedCommand,
} from './run-with-ollama-memory-guard.mjs';

const quietLogger = {
  log() {},
  warn() {},
};

function jsonResponse(body, { ok = true, onText = () => {}, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      onText();
      return JSON.stringify(body);
    },
  };
}

test('unloads resident Ollama models during a guarded build', async () => {
  let consumedUnloadResponses = 0;
  const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push({ options, url: String(url) });

    if (String(url).endsWith('/api/ps')) {
      return jsonResponse({ models: [{ name: 'gemma4:e2b' }, { name: 'embedding-model' }] });
    }

    return jsonResponse({}, {
      onText: () => {
        consumedUnloadResponses += 1;
      },
    });
  };

  const releasedModels = await releaseResidentModels({
    baseUrl: 'http://ollama.test',
    fetcher,
    logger: quietLogger,
  });

  assert.deepEqual(releasedModels, ['gemma4:e2b', 'embedding-model']);
  assert.deepEqual(
    requests.slice(1).map((request) => JSON.parse(request.options.body)),
    [
      { keep_alive: 0, model: 'gemma4:e2b' },
      { keep_alive: 0, model: 'embedding-model' },
    ]
  );
  assert.ok(requests.slice(1).every((request) => request.url === 'http://ollama.test/api/generate'));
  assert.equal(consumedUnloadResponses, 2);
});

test('does not request an unload when Ollama has no resident models', async () => {
  const requests = [];

  const releasedModels = await releaseResidentModels({
    baseUrl: 'http://ollama.test',
    fetcher: async (url) => {
      requests.push(String(url));
      return jsonResponse({ models: [] });
    },
    logger: quietLogger,
  });

  assert.deepEqual(releasedModels, []);
  assert.deepEqual(requests, ['http://ollama.test/api/ps']);
});

test('continues without failure when Ollama is unavailable', async () => {
  const warnings = [];

  const releasedModels = await releaseResidentModels({
    fetcher: async () => {
      throw new Error('connect refused');
    },
    logger: {
      log() {},
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.deepEqual(releasedModels, []);
  assert.match(warnings[0], /continuing build/);
});

test('rejects a guarded command without an executable', async () => {
  await assert.rejects(
    runGuardedCommand([]),
    /Usage: run-with-ollama-memory-guard\.mjs/
  );
  await assert.rejects(
    runGuardedCommand(null),
    /Usage: run-with-ollama-memory-guard\.mjs/
  );
});

test('returns the child exit code and removes polling and signal listeners', async () => {
  const child = new EventEmitter();
  child.kill = () => {};
  let releaseCalls = 0;
  const initialSigintListeners = process.listenerCount('SIGINT');

  const resultPromise = runGuardedCommand(['vercel', 'build'], {
    pollIntervalMs: 2,
    release: async () => {
      releaseCalls += 1;
    },
    spawnChild: () => child,
  });

  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 17, null);

  const result = await resultPromise;
  const callsAtExit = releaseCalls;
  await new Promise((resolve) => setTimeout(resolve, 8));

  assert.deepEqual(result, { code: 17, signal: null });
  assert.equal(releaseCalls, callsAtExit);
  assert.equal(process.listenerCount('SIGINT'), initialSigintListeners);
});

test('does not overlap periodic release checks', async () => {
  const child = new EventEmitter();
  child.kill = () => {};
  let releaseCalls = 0;
  let resolvePeriodicRelease;
  let notifyPeriodicReleaseStarted;
  const periodicReleaseStarted = new Promise((resolve) => {
    notifyPeriodicReleaseStarted = resolve;
  });

  const resultPromise = runGuardedCommand(['vercel', 'build'], {
    pollIntervalMs: 2,
    release: async () => {
      releaseCalls += 1;

      if (releaseCalls > 1) {
        notifyPeriodicReleaseStarted();
        await new Promise((resolve) => {
          resolvePeriodicRelease = resolve;
        });
      }
    },
    spawnChild: () => child,
  });

  await periodicReleaseStarted;
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(releaseCalls, 2);

  resolvePeriodicRelease();
  child.emit('exit', 0, null);
  await resultPromise;
});

test('uses the pinned Vercel CLI for the production prebuilt build', async () => {
  const workflow = await readFile(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');

  assert.match(workflow, /- name: Build for Vercel\n\s+run: \.github\/scripts\/run-pinned-vercel\.sh build --yes --prod/);
  assert.doesNotMatch(workflow, /pnpm dlx --allow-build=esbuild vercel@\d+\.\d+\.\d+ build/);
});
