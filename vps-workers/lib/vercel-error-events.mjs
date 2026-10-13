import { createHash } from 'node:crypto';

export {
  MAX_JSONL_READ_BYTES,
  MAX_JSONL_ROTATED_FILES,
} from './vercel-error-events-limits.mjs';
export { readJsonlLogEvents } from './vercel-error-events-reader.mjs';

const ERROR_LEVELS = new Set(['error', 'fatal', 'panic']);
const ERROR_MESSAGE_RE =
  /\b(error|exception|unhandled|failed|timed out|timeout)\b/i;
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const REQUEST_ID_RE = /\b(req|request|trace|span|dpl)_[a-z0-9_-]+\b/gi;
const NUMBER_RE = /\b\d+\b/g;
const URL_RE = /https?:\/\/\S+/gi;
const DYNAMIC_ROUTE_SEGMENT_RE = /\/[0-9a-f]{6,}(?=\/|$)|\/\d+(?=\/|$)/gi;

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

function firstTimestamp(...values) {
  for (const value of values) {
    const parsed =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : typeof value === 'string' && value.trim()
          ? Date.parse(value.trim())
          : Number.NaN;
    if (Number.isFinite(parsed)) {
      const date = new Date(parsed);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  return '';
}

function routeWithoutQueryOrFragment(...values) {
  return firstString(...values).split(/[?#]/, 1)[0];
}

export function normalizeVercelLogEvent(raw) {
  const entry = raw && typeof raw === 'object' ? raw : {};
  const error =
    entry.error && typeof entry.error === 'object' ? entry.error : {};
  const message = firstString(
    entry.message,
    entry.msg,
    entry.text,
    entry.body,
    error.message,
    entry.stack
  );
  const technicalText = [
    entry.message,
    entry.msg,
    entry.text,
    entry.body,
    error.message,
    entry.stack,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
  const route = routeWithoutQueryOrFragment(
    entry.route,
    entry.path,
    entry.pathname,
    entry.requestPath,
    entry.request?.path,
    entry.request?.url
  );

  return {
    deploymentId: firstString(entry.deploymentId, entry.deployment, entry.dpl),
    errorClass: technicalErrorClass(technicalText),
    fingerprint: '',
    level: firstString(entry.level, entry.severity).toLowerCase(),
    message,
    projectName: firstString(entry.projectName, entry.project, entry.projectId),
    requestId: firstString(entry.requestId, entry.request?.id, entry.id),
    route,
    source: firstString(entry.source, entry.type),
    statusCode: firstNumber(
      entry.statusCode,
      entry.status,
      entry.response?.statusCode
    ),
    timestamp: firstTimestamp(entry.timestamp, entry.time, entry.createdAt),
  };
}

export function isErrorEvent(event) {
  if (!event) {
    return false;
  }
  if (String(event.source || '').toLowerCase() === 'firewall') {
    return false;
  }
  if (ERROR_LEVELS.has(String(event.level || '').toLowerCase())) {
    return true;
  }
  if (Number(event.statusCode) >= 500) {
    return true;
  }
  return ERROR_MESSAGE_RE.test(event.message || '');
}

function normalizeMessageForFingerprint(message) {
  return String(message || '')
    .replace(URL_RE, '<url>')
    .replace(UUID_RE, '<uuid>')
    .replace(REQUEST_ID_RE, '<id>')
    .replace(/:\d+:\d+/g, ':<line>:<column>')
    .replace(/:\d+/g, ':<line>')
    .replace(NUMBER_RE, '<num>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 500);
}

function normalizeRouteForFingerprint(route) {
  return String(route || '')
    .split('?')[0]
    .replace(DYNAMIC_ROUTE_SEGMENT_RE, '/<id>')
    .replace(/\/+/g, '/')
    .toLowerCase()
    .slice(0, 160);
}

export function fingerprintErrorEvent(event) {
  const basis = [
    normalizeRouteForFingerprint(event.route),
    normalizeMessageForFingerprint(event.message),
  ].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

function categoryForEvent(event) {
  if (/\btimed out\b|\btimeout\b/i.test(event.message || '')) {
    return 'vercel_timeout';
  }
  if (Number(event.statusCode) >= 500) {
    return 'vercel_http_5xx';
  }
  return 'vercel_runtime_exception';
}

function technicalErrorClass(message) {
  const text = String(message || '');
  return (
    /\b(TypeError|ReferenceError|RangeError|SyntaxError|URIError)\b/.exec(
      text
    )?.[1] || (/\bError\b/.test(text) ? 'Error' : '')
  );
}

export function groupErrorEvents(rawEvents) {
  const groups = new Map();
  for (const rawEvent of rawEvents) {
    const event = normalizeVercelLogEvent(rawEvent);
    if (!isErrorEvent(event)) {
      continue;
    }
    const fingerprint = fingerprintErrorEvent(event);
    const category = categoryForEvent(event);
    const groupKey = `${category}:${fingerprint}`;
    event.fingerprint = fingerprint;
    const group = groups.get(groupKey) || {
      category,
      deploymentIds: new Set(),
      events: [],
      fingerprint,
      firstSeen: '',
      lastSeen: '',
      requestIds: new Set(),
      sample: event,
    };
    group.events.push(event);
    if (event.deploymentId) {
      group.deploymentIds.add(event.deploymentId);
    }
    if (event.requestId) {
      group.requestIds.add(event.requestId);
    }
    if (event.timestamp) {
      if (!group.firstSeen || event.timestamp < group.firstSeen) {
        group.firstSeen = event.timestamp;
      }
      if (!group.lastSeen || event.timestamp > group.lastSeen) {
        group.lastSeen = event.timestamp;
      }
    }
    groups.set(groupKey, group);
  }
  return [...groups.values()].sort(
    (left, right) => right.events.length - left.events.length
  );
}

export function selectRemediationCandidates(
  groups,
  { minOccurrences = 2 } = {}
) {
  return groups
    .filter((group) => group.events.length >= minOccurrences)
    .map((group) => ({
      category: group.category,
      fingerprint: group.fingerprint,
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      occurrences: group.events.length,
      sample: {
        deploymentId: group.sample.deploymentId,
        errorClass: group.sample.errorClass,
        requestId: group.sample.requestId,
        route: group.sample.route,
        source: 'vercel',
        statusCode:
          group.sample.statusCode == null
            ? ''
            : String(group.sample.statusCode),
      },
      source: 'vercel',
    }));
}
