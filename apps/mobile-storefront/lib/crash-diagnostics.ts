import * as Sentry from '@sentry/react-native';
import { createLogger } from './logger';

const log = createLogger('CrashDiagnostics');
const SAFE_DETAIL_KEYS = new Set([
  'blockCount',
  'focused',
  'hasPageConfig',
  'isError',
  'isFocused',
  'primaryProductGridIndex',
  'productGridBlockCount',
  'isInitialized',
  'isStorageReady',
  'api_level',
  'warning_count',
  'businessType',
  'templateId',
  'template_id',
  'instance_id',
  'os',
  'renderer',
  'surface',
  'variant',
  'app_state',
]);

export const MAX_BREADCRUMBS = 30;

export interface CrashBreadcrumb {
  details?: Record<string, unknown>;
  name: string;
  timestamp: string;
}

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
}

type GlobalWithErrorUtils = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
};

let breadcrumbs: CrashBreadcrumb[] = [];
let installed = false;
let previousGlobalHandler: GlobalErrorHandler | undefined;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
    name: 'NonError',
  };
}

export function recordCrashBreadcrumb(
  name: string,
  details?: Record<string, unknown>
) {
  const breadcrumb: CrashBreadcrumb = {
    details,
    name,
    timestamp: new Date().toISOString(),
  };
  breadcrumbs = [...breadcrumbs, breadcrumb].slice(-MAX_BREADCRUMBS);

  // This buffer alone is lost on native process death. Persist only technical
  // state to Sentry's native breadcrumb store; errors and IDs stay local.
  const data = Object.fromEntries(
    Object.entries(details ?? {}).filter(
      ([key, value]) =>
        SAFE_DETAIL_KEYS.has(key) &&
        (typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)))
    )
  );
  try {
    Sentry.addBreadcrumb({
      category: 'app.diagnostics',
      message: name.slice(0, 160),
      level: 'info',
      data,
    });
  } catch {
    // Native diagnostics must never prevent startup or error-handler chaining.
  }

  if (process.env.NODE_ENV !== 'test') {
    log.info('breadcrumb', breadcrumb);
  }
}

export function installCrashDiagnostics(context = 'global') {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as GlobalWithErrorUtils).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) {
    recordCrashBreadcrumb('crash_diagnostics:error_utils_unavailable', {
      context,
    });
    return;
  }

  previousGlobalHandler = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    log.error('global JS error', {
      breadcrumbs,
      context,
      error: serializeError(error),
      isFatal,
    });
    previousGlobalHandler?.(error, isFatal);
  });

  recordCrashBreadcrumb('crash_diagnostics:installed', { context });
}

export function getCrashBreadcrumbsForTest() {
  return breadcrumbs;
}

export function resetCrashDiagnosticsForTest() {
  if (process.env.NODE_ENV !== 'test') return;
  breadcrumbs = [];
  installed = false;
  previousGlobalHandler = undefined;
}
