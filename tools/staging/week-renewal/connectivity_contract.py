from datetime import datetime, timezone
import shlex

from renewal_contract import TARGET, TARGET_EPOCH, Refused


REPORT_PATH = '/root/baci-activation-evidence.S88Q16M1/activation-evidence.json'
REPORT_SHA256 = '21bf0adf89c122c11353b53e17f90cdfc815484367e9ce3e228fce90729a1236'
EVIDENCE_BUNDLE_SHA256 = '5455f4aecf9fc7ce55b856a6582ac9ac698fafd23d490beeb17fccc18382a89c'
FALSE_FIELDS = ('renewalApplied', 'liveChangesMade', 'databaseApplied', 'newPaymentStarted',
                'activationReady', 'financialReplayEnabled', 'authenticatedCustomerVerified')
STABLE_FIELDS = ('preparation', 'currentFinancialFences', 'publicJwtProofs', 'fundingEnvironment',
                 'upstreams', 'firewall', 'gatewayGraph', 'databaseDeadlineFunctions',
                 'interestBridge', 'receiptDatabase')
SERVICES = ('baci-savings-gateway.service', 'baci-savings-drafts.service', 'baci-savings-funding.service')
TIMERS = ('baci-savings-drafts-deadline.timer', 'baci-savings-funding-deadline.timer')
EXPIRED_FUNDING = 'baci-savings-funding.service'


def validate_fresh(reviewed, fresh, now):
    if (fresh.get('stage') != 'lane-a-activation-evidence' or fresh.get('status') != 'review-required'
            or fresh.get('readOnly') is not True or fresh.get('requestedServiceDeadline') != TARGET
            or any(fresh.get(name) is not False for name in FALSE_FIELDS) or now >= TARGET_EPOCH):
        raise Refused('connectivity-evidence-contract')
    try:
        observed = datetime.fromisoformat(fresh['observedAt']).timestamp()
    except (KeyError, ValueError, TypeError):
        raise Refused('connectivity-evidence-time') from None
    if not 0 <= now - observed <= 120:
        raise Refused('connectivity-evidence-time')
    for field in STABLE_FIELDS:
        if field not in reviewed or fresh.get(field) != reviewed[field]:
            raise Refused('connectivity-evidence-drift')
    role = fresh.get('fundingDatabaseRole')
    expected_role = dict(reviewed.get('fundingDatabaseRole', {}))
    if isinstance(role, dict) and role.get('expiresAtEpoch') == TARGET_EPOCH:
        expected_role.update(expiresAtEpoch=TARGET_EPOCH, coversRequestedDeadline=True)
    if role != expected_role:
        raise Refused('connectivity-evidence-drift')
    if (any(fresh['upstreams'].get(name, {}).get('healthHttp') != 200 for name in ('auth', 'rest'))
            or fresh['firewall'] != [{'bridge': name, 'reviewedDropRulePresent': True}
                                     for name in ('baci-stg-db', 'baci-stg-mail')]):
        raise Refused('connectivity-upstream-firewall')


def stop_targets(content, name):
    values = [line.removeprefix('ExecStart=') for line in content.decode().splitlines()
              if line.startswith('ExecStart=')]
    if len(values) != 1:
        raise Refused('deadline-stop-contract')
    arguments = shlex.split(values[0])
    expected = 'baci-savings-drafts.service' if name == 'baci-savings-drafts-deadline.service' else 'baci-savings-funding.service'
    allowed = {expected}
    if expected == 'baci-savings-drafts.service':
        allowed.add('baci-savings-gateway.service')
    if (arguments[:2] not in (['/usr/bin/systemctl', 'stop'], ['/bin/systemctl', 'stop'])
            or expected not in arguments[2:] or not set(arguments[2:]) <= allowed
            or len(set(arguments[2:])) != len(arguments[2:])):
        raise Refused('deadline-stop-contract')
    return arguments


def timer_schedule(value, expected_unit):
    try:
        deadline = datetime.strptime(value['NextElapseUSecRealtime'], '%a %Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc)
    except (KeyError, ValueError, TypeError):
        raise Refused('deadline-schedule') from None
    if (value.get('Unit') != expected_unit or value.get('ActiveState') != 'active'
            or value.get('SubState') != 'waiting' or int(deadline.timestamp()) != TARGET_EPOCH
            or value.get('AccuracyUSec') not in ('1s', '1ms', '1us')
            or value.get('RandomizedDelayUSec') not in ('0', '0s')):
        raise Refused('deadline-schedule')
