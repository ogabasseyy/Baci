import hashlib
import json
from datetime import datetime, timezone


OLD_EPOCH = 1790697550
TARGET = '2026-10-06T15:59:10Z'
GATEWAY_TARGET = '2026-10-06T15:59:10.442Z'
OLD_GATEWAY = '2026-09-29T15:59:10.442Z'
TARGET_EPOCH = int(datetime.fromisoformat(TARGET.replace('Z', '+00:00')).timestamp())
SYSTEM = '7685292944002592802'
RECEIPT_SYSTEM = '7686901100561231906'
UNIT_DIRECTORY = '/etc/systemd/system/'
BINDING = '/etc/baci-savings-gateway/binding.json'
EVIDENCE = '/etc/baci-savings-gateway/startup-evidence.json'
FUNDING_ENV = '/etc/baci/piggyvest-staging/funding-service.env'
GATEWAY_CODE = '/opt/baci-savings-gateway/managed-gateway.mjs'
REVIEWED_ROUTE_COUNT = 23
ROUTES_SHA256 = 'c28b7b7aa1913665a2df309920931a547f22df73fa5ae88bc52a4f66ddae1764'
PINS = {
    BINDING: '30b0e1b36b75f2e32348242d1f5808c1e2b58126ff1311540d6384cf1aeb2fb2',
    EVIDENCE: '1ff5330fff1ed3ea5d9ef19d0a840822d011016a31a885d188fa18520528eff5',
    GATEWAY_CODE: '94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825',
    FUNDING_ENV: 'e867a511d34a03e263867665348f45688ddf4e5abb8111316ff2f2870e69f2d2',
    UNIT_DIRECTORY + 'baci-savings-gateway.service': '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3',
    UNIT_DIRECTORY + 'baci-savings-drafts.service': '262b02fad74a4182f6a2b0a640124743fba8fcfc753508a9c9e44a073c6b6082',
    UNIT_DIRECTORY + 'baci-savings-funding.service': '14376f8ba39c7b4a417fa0488f437e2ac5fab3917f9120021d6276f6f59d6162',
    UNIT_DIRECTORY + 'baci-savings-drafts-deadline.timer': 'be0beb1db2e5399ff1f66a992257e245bec6085c8caae39cc0d7a81263a582b6',
    UNIT_DIRECTORY + 'baci-savings-funding-deadline.timer': '6ce0fd4abbc967cfaad2dd7849562607eba5c73cfab91147fe63a14f6284096a',
    UNIT_DIRECTORY + 'baci-savings-drafts-deadline.service': '02232c63731343e419492b312448eba7b8625d8e946e58e7c8db55f2ce5037ee',
    UNIT_DIRECTORY + 'baci-savings-funding-deadline.service': '4d514e492e96201927ea6c2d63c51a5beab4b6696368f037cce5e867fb2aa2fe',
}
PROTECTED_SERVICES = (
    'baci-prefunded-public.service', 'baci-prefunded-background.service',
    'baci-prefunded-snapshot.service', 'baci-staging-test-payments.service',
    'baci-savings-notifications.service', 'baci-savings-notifications-check.service',
    'baci-savings-drafts-smoke.service',
)
PROTECTED_TIMERS = (
    'baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
    'baci-savings-notifications.timer',
)
PROTECTED_CONTAINERS = (
    'baci-prefunded-public', 'baci-prefunded-background',
    'baci-prefunded-snapshot', 'pvb-staging-replay-prefunded',
)
REPLAY_CONFIGS = (
    '/etc/baci/prefunded-card/replay-base.prepared.json',
    '/opt/baci-prefunded-replay/config/config.json',
    '/opt/baci-prefunded-replay/config/prefunded.json',
)
GATES = (
    'parent-review-and-separate-sealed-activation-wrapper-required',
    'fresh-gateway-inventory-firewall-reachability-and-startup-evidence-required',
    'fresh-physical-database-invariants-and-retirement-fences-required',
    'auth-jwt-signature-issuer-audience-and-expiry-proof-required',
    'funding-jwts-expired-not-rotated-by-preparation',
    'funding-expired-runtime-must-stop-before-any-install',
    'deadline-timers-effective-stop-targets-and-schedule-proof-required',
    'expired-inflow-and-mapping-sql-require-separately-reviewed-renewal',
    'financial-replay-stays-off-no-bank-inflow-completion-claim',
    'paid-interest-bridge-absent-parent-owned-not-renewed-here',
    'notifications-worker-expired-not-renewed-here',
    'unauthenticated-only-runtime-probes-after-separate-activation-required',
)


class Refused(RuntimeError):
    pass


def digest(content):
    return hashlib.sha256(content).hexdigest()


def canonical(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def parse_json(content):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise Refused('duplicate-json-key')
            value[key] = item
        return value
    try:
        return json.loads(content, object_pairs_hook=unique)
    except (ValueError, TypeError, UnicodeError):
        raise Refused('invalid-json') from None


def milliseconds(value):
    try:
        moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if moment.tzinfo != timezone.utc or moment.isoformat(timespec='milliseconds').replace('+00:00', 'Z') != value:
            raise ValueError()
        return int(moment.timestamp() * 1000)
    except (ValueError, TypeError, AttributeError):
        raise Refused('invalid-lease-time') from None


def renewed_binding(content, now_ms):
    binding = parse_json(content)
    if (not isinstance(binding, dict) or set(binding) != {'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'}
            or type(binding['version']) is not int or binding['version'] != 1):
        raise Refused('binding-shape')
    identity = binding['identity']
    if (not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'}
            or identity['host'] != 'staging-auth.ogabassey.com'):
        raise Refused('binding-identity')
    routes = identity['restRoutes']
    if not isinstance(routes, list) or len(routes) != REVIEWED_ROUTE_COUNT:
        raise Refused('binding-23-routes')
    paths = set()
    for route in routes:
        if (not isinstance(route, dict) or set(route) != {'path', 'methods'}
                or not isinstance(route['path'], str) or not route['path'].startswith('/rest/v1/')
                or route['path'] in paths or not isinstance(route['methods'], list) or not route['methods']
                or any(method not in ('GET', 'HEAD', 'POST', 'PATCH') for method in route['methods'])
                or len(set(route['methods'])) != len(route['methods'])):
            raise Refused('binding-route-contract')
        paths.add(route['path'])
    normalized_routes = canonical([{'methods': route['methods'], 'path': route['path']} for route in routes])
    if digest(normalized_routes) != ROUTES_SHA256:
        raise Refused('binding-route-contract')
    reviewed, start, end = [milliseconds(binding[key]) for key in ('reviewedAt', 'leaseNotBefore', 'leaseExpiresAt')]
    target = milliseconds(GATEWAY_TARGET)
    if (binding['leaseExpiresAt'] != OLD_GATEWAY or not 0 < reviewed <= start < end
            or end - start > 604800000 or type(now_ms) is not int or not end <= now_ms < target
            or target - now_ms > 604800000):
        raise Refused('binding-lease-window')
    fresh = datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return canonical({**binding, 'reviewedAt': fresh, 'leaseNotBefore': fresh, 'leaseExpiresAt': GATEWAY_TARGET})


def replace_line(content, old, new):
    lines = content.splitlines(keepends=True)
    if lines.count(old) != 1:
        raise Refused('exact-lease-line-required')
    return b''.join(new if line == old else line for line in lines)


def candidates(contents, now_ms):
    if set(contents) != set(PINS) or any(digest(contents[path]) != expected for path, expected in PINS.items()):
        raise Refused('predecessor-pin')
    preview = renewed_binding(contents[BINDING], now_ms)
    old_binding = parse_json(contents[BINDING])
    evidence = parse_json(contents[EVIDENCE])
    if (not isinstance(evidence, dict) or set(evidence) != {'receipt', 'inventory'}
            or not isinstance(evidence['receipt'], dict)
            or {key: evidence['receipt'].get(key) for key in old_binding['identity']} != old_binding['identity']):
        raise Refused('predecessor-evidence-identity')
    drafts = UNIT_DIRECTORY + 'baci-savings-drafts.service'
    funding = UNIT_DIRECTORY + 'baci-savings-funding.service'
    old_draft = b'ExecCondition=/bin/sh -c \'[ "$(/bin/date -u +%%s)" -lt 1790697550 ]\'\n'
    old_funding = b'ExecCondition=/bin/sh -c \'test "$BACI_SAVINGS_LEASE_EXPIRES_AT" = "1790697550" && test "$(/bin/date -u +%%s)" -lt "1790697550"\'\n'
    for path in (drafts, funding, UNIT_DIRECTORY + 'baci-savings-gateway.service'):
        if contents[path].splitlines().count(b'RuntimeMaxSec=7d') != 1:
            raise Refused('reviewed-runtime-cap')
    result = {'binding.preview.json': preview,
              'baci-savings-drafts.service': replace_line(contents[drafts], old_draft, old_draft.replace(str(OLD_EPOCH).encode(), str(TARGET_EPOCH).encode())),
              'baci-savings-funding.service': replace_line(contents[funding], old_funding, old_funding.replace(str(OLD_EPOCH).encode(), str(TARGET_EPOCH).encode()))}
    old_env = b'BACI_SAVINGS_LEASE_EXPIRES_AT=1790697550\n'
    result['funding-service.env'] = replace_line(contents[FUNDING_ENV], old_env, old_env.replace(str(OLD_EPOCH).encode(), str(TARGET_EPOCH).encode()))
    for name in ('baci-savings-drafts-deadline.timer', 'baci-savings-funding-deadline.timer'):
        result[name] = replace_line(contents[UNIT_DIRECTORY + name], b'OnCalendar=2026-09-29 15:59:10 UTC\n', b'OnCalendar=2026-10-06 15:59:10 UTC\n')
    return result


def inventory_summary(content):
    lines = content.splitlines()
    if len(lines) != 2 or lines[1] != b'STAGING_WEEK_RENEWAL_INVENTORY_READY':
        raise Refused('inventory-format')
    report = parse_json(lines[0])
    if (not isinstance(report, dict) or report.get('readOnly') is not True
            or report.get('changesMade') is not False or report.get('renewalApplied') is not False
            or report.get('newPaymentStarted') is not False):
        raise Refused('inventory-contract')
    for key, expected in (('database', SYSTEM), ('receiptDatabase', RECEIPT_SYSTEM)):
        item = report.get(key)
        if not isinstance(item, dict) or item.get('systemIdentifier') != expected or item.get('readOnly') is not True:
            raise Refused('physical-database-pin')
    database = report['database']
    treasury = database.get('treasury')
    intents = database.get('intents')
    if (database.get('principalKobo') != 10000 or not isinstance(treasury, dict)
            or treasury.get('id') != 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
            or treasury.get('verifiedAvailableKobo') != 10000 or treasury.get('reservedKobo') != 0
            or treasury.get('consumedKobo') != 0 or not isinstance(intents, list) or len(intents) != 1
            or intents[0].get('id') != 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
            or intents[0].get('phase') != 'retired_unconfirmed'):
        raise Refused('historical-financial-invariants')
    expiries = []
    files = report.get('files')
    if not isinstance(files, list):
        raise Refused('inventory-files')
    for path in REPLAY_CONFIGS:
        entries = [item for item in files if isinstance(item, dict) and item.get('path') == path]
        if len(entries) != 1:
            raise Refused('replay-inventory-identity')
        claims = entries[0].get('unverifiedJwtExpiryClaims', {})
        if not isinstance(claims, dict):
            raise Refused('jwt-expiry-metadata')
        for name in ('receiptToken', 'appToken', 'restToken'):
            values = claims.get(name, [])
            if not isinstance(values, list) or len(values) > 8 or any(type(value) is not int or not 0 < value < 10000000000 for value in values):
                raise Refused('jwt-expiry-metadata')
            expiries.extend(values)
    return {'physicalSystems': [SYSTEM, RECEIPT_SYSTEM], 'principalKobo': 10000,
            'treasuryReservedKobo': 0, 'treasuryConsumedKobo': 0, 'treasuryApprovedKobo': 10000,
            'oldIntentRetained': True, 'replayJwtExpiryUnverified': sorted(set(expiries)),
            'replayJwtCoversTargetUnverified': bool(expiries) and min(expiries) > TARGET_EPOCH}
