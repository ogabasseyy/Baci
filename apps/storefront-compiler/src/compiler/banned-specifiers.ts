const BANNED_RUNTIME_SPECIFIERS: ReadonlySet<string> = new Set([
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'perf_hooks',
  'process',
  'readline',
  'repl',
  'stream',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

const BANNED_IMPORT_PREFIXES = [
  'node:',
  'cloudflare:',
  'workerd:',
  'bun:',
  'deno:',
  'http:',
  'https:',
  'data:',
  'file:',
] as const;

export const SENSITIVE_GLOBAL_ROOTS: ReadonlySet<string> = new Set([
  'globalThis',
  'window',
  'self',
  'document',
  'navigator',
  'top',
  'parent',
  'frames',
]);

export const FORBIDDEN_STORAGE_GLOBALS: ReadonlySet<string> = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'CacheStorage',
  'IDBFactory',
  'Storage',
  'openDatabase',
  'sharedStorage',
  'cookieStore',
]);

export const FORBIDDEN_STORAGE_MEMBERS: ReadonlySet<string> = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'openDatabase',
  'sharedStorage',
  'cookie',
  'cookieStore',
]);

export const FORBIDDEN_BROWSER_NAV_GLOBALS: ReadonlySet<string> = new Set([
  'location',
  'history',
  'navigation',
  'open',
  'opener',
]);

export const SAFE_NAVIGATOR_MEMBERS: ReadonlySet<string> = new Set([
  'language',
  'languages',
  'onLine',
  'maxTouchPoints',
  'userAgent',
  'vendor',
]);

export const FORBIDDEN_BROWSER_CAPABILITY_GLOBALS: ReadonlySet<string> =
  new Set(
    [
      'Notification|PaymentRequest|PublicKeyCredential|CredentialsContainer',
      'showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|queryLocalFonts',
      'EyeDropper|IdleDetector|BarcodeDetector|SpeechRecognition|webkitSpeechRecognition',
      'speechSynthesis|RTCPeerConnection|webkitRTCPeerConnection|MediaRecorder',
      'Accelerometer|Gyroscope|Magnetometer|AmbientLightSensor',
      'AbsoluteOrientationSensor|RelativeOrientationSensor',
      'Worker|SharedWorker|BroadcastChannel|MessageChannel',
      'geolocation|mediaDevices|clipboard|credentials|permissions',
      'bluetooth|usb|hid|serial|wakeLock|locks|sendBeacon|share|xr',
    ]
      .join('|')
      .split('|')
  );

export const BENIGN_OBJECT_DATA_KEYS: ReadonlySet<string> = new Set([
  'assign',
  'click',
  'submit',
  'write',
  'writeln',
  'constructor',
  'cookie',
  'serviceWorker',
]);

export const DYNAMIC_CODE_NAMES: ReadonlySet<string> = new Set([
  'eval',
  'Function',
  'Reflect',
  'Proxy',
  'constructor',
  'prototype',
  '__proto__',
  'fromEntries',
  'defineProperty',
  'defineProperties',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getPrototypeOf',
  'setPrototypeOf',
]);

export const BANNED_MERCHANT_SUBPATH_SPECIFIERS: ReadonlySet<string> = new Set([
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
  'react-dom/server',
  'react-dom/server.browser',
  'react-dom/server.edge',
  'react-dom/server.node',
]);

export function isProhibitedImportSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  if (BANNED_IMPORT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  const rootName = trimmed.startsWith('@')
    ? trimmed.split('/').slice(0, 2).join('/')
    : (trimmed.split('/')[0] ?? '');
  return (
    BANNED_RUNTIME_SPECIFIERS.has(trimmed) ||
    BANNED_RUNTIME_SPECIFIERS.has(rootName)
  );
}
