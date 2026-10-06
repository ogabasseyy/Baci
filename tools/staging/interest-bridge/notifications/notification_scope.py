"""Pure mutation fence for one reviewed ordinary notification timer resume.

Inventories and full snapshots must be collected together in the same actual
read-only transaction, using authenticated fixed SQL. Expected new event content
hashes are a finite reviewed forecast, never a caller's blanket permission.
"""

import copy
from datetime import datetime
import re

import notification_contract


MERCHANT = '10000000-0000-4000-8000-000000000001'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
ACTOR = 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
GOALS = {'430314fd-cd8b-4579-98d4-e9f345713dd6', '9f01153c-1589-4dde-b9aa-8f644a846832'}
TABLES = {'savings_notifications.events', 'savings_notifications.deliveries'}
TERMINAL = {'rejected', 'unknown', 'suppressed', 'provider_confirmed', 'receipt_failed', 'receipt_unknown'}


def require(value):
    if not value:
        raise ValueError('notification_scope_refused')


def stamp(value):
    require(type(value) is str)
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+00:00)', value)
    require(match is not None)
    fraction = '.'+match[2].ljust(6, '0') if match[2] else ''
    parsed = datetime.fromisoformat(match[1]+fraction+'+00:00')
    require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0)
    return parsed


def digest(value):
    require(type(value) is str and re.fullmatch('[a-f0-9]{64}', value))


def index(rows, fields):
    require(type(rows) is list)
    result = {}
    for row in rows:
        require(type(row) is dict)
        key = tuple(row[field] for field in fields)
        require(key not in result)
        result[key] = row
    return result


def validate(value):
    require(type(value) is dict and set(value) == {'capturedAt', 'goals', 'events', 'tokens', 'deliveries', 'tables'})
    stamp(value['capturedAt'])
    goals = index(value['goals'], ('id',))
    require(set(key[0] for key in goals) == GOALS)
    for row in [*value['goals'], *value['events']]:
        require(row['merchant'] == MERCHANT and row['customer'] == CUSTOMER and row['actor'] == ACTOR)
        digest(row['rowSha256'])
    for row in value['events']:
        require(row['goal'] in GOALS)
        digest(row['immutableSha256'])
        digest(row['contentSha256'])
        stamp(row['createdAt'])
        if row['expandedAt'] is not None:
            stamp(row['expandedAt'])
    events = index(value['events'], ('id',))
    index(value['events'], ('merchant', 'customer', 'goal', 'eventKey'))
    tokens = index(value['tokens'], ('tokenSha256',))
    for row in tokens.values():
        require(row['merchant'] == MERCHANT and row['actor'] == ACTOR)
        digest(row['tokenSha256'])
        digest(row['rowSha256'])
    deliveries = index(value['deliveries'], ('notificationId', 'tokenSha256'))
    for key, row in deliveries.items():
        require((key[0],) in events)
        digest(key[1])
        digest(row['rowSha256'])
        require(row['status'] in TERMINAL | {'pending', 'dispatching', 'accepted'})
        require(set(row['columnHashes']) == {'notification_id', 'push_token', 'status', 'claim_id',
            'claimed_at', 'ticket_id', 'receipt_error'})
        for column in row['columnHashes'].values():
            digest(column)
    require(set(value['tables']) == TABLES)
    for name in TABLES:
        table = value['tables'][name]
        require(set(table) == {'oid', 'count', 'sha256'} and type(table['oid']) is int and table['oid'] > 0
            and type(table['count']) is int and table['count'] == len(value['events'] if name.endswith('.events')
                else value['deliveries']))
        digest(table['sha256'])
    return events, deliveries, tokens


def validate_database(value):
    require(set(value) == {'role', 'routines', 'directExecutions', 'effectiveDefiners'})
    expected = dict(exists=True, canLogin=True, inherit=False, superuser=False, bypassRls=False,
        createDb=False, createRole=False, replication=False, configIsNull=True, memberCount=0,
        validUntil=notification_contract.TARGET)
    require(type(value['role']) is dict and set(value['role']) == set(expected)
        and all(type(value['role'][key]) is type(item) and value['role'][key] == item
            for key, item in expected.items()))
    notification_contract.validate_routines(value['routines'])
    functions = {'savings_notifications.'+name.replace(', ', ',') for name in notification_contract.EXECUTABLE}
    for key in ('directExecutions', 'effectiveDefiners'):
        require(type(value[key]) is list and len(value[key]) == len(functions) and set(value[key]) == functions)


def verify_transition(before, after, expected_new):
    old, old_deliveries, tokens = validate(before)
    current, deliveries, _ = validate(after)
    start, end = stamp(before['capturedAt']), stamp(after['capturedAt'])
    require(start <= end and (end-start).total_seconds() <= 120)
    require(before['goals'] == after['goals'] and before['tokens'] == after['tokens'])
    for name in TABLES:
        require(before['tables'][name]['oid'] == after['tables'][name]['oid'])
    require(set(old) <= set(current) and set(old_deliveries) <= set(deliveries))
    for key, row in old.items():
        new = current[key]
        require({field: value for field, value in row.items() if field not in ('expandedAt', 'rowSha256')}
            == {field: value for field, value in new.items() if field not in ('expandedAt', 'rowSha256')})
        if row['expandedAt'] != new['expandedAt']:
            require(row['expandedAt'] is None and new['expandedAt'] is not None
                and start <= stamp(new['expandedAt']) <= end)
        else:
            require(row['rowSha256'] == new['rowSha256'])
    expected = index(expected_new, ('goal', 'eventKey'))
    require(len(expected) <= 16)
    for row in expected.values():
        require(set(row) == {'goal', 'eventKey', 'type', 'contentSha256'} and row['goal'] in GOALS
            and row['type'] in ('missed_contribution', 'weekly_summary'))
        digest(row['contentSha256'])
    for key in set(current)-set(old):
        row = current[key]
        require(expected.get((row['goal'], row['eventKey'])) == {field: row[field] for field in
            ('goal', 'eventKey', 'type', 'contentSha256')} and start <= stamp(row['createdAt']) <= end)
        require(row['expandedAt'] is None or start <= stamp(row['expandedAt']) <= end)
    for key, new in deliveries.items():
        prior = old_deliveries.get(key)
        if prior == new:
            continue
        require((key[1],) in tokens)
        if prior:
            require(prior['status'] not in TERMINAL)
            changes = {column for column in new['columnHashes']
                if new['columnHashes'][column] != prior['columnHashes'][column]}
            allowed = {'status', 'ticket_id'} if prior['status'] == 'dispatching' else (
                {'status', 'receipt_error'} if prior['status'] == 'accepted' else
                {'status', 'claim_id', 'claimed_at', 'ticket_id'})
            require(changes <= allowed)
            outcomes = {'unknown', 'accepted', 'rejected'} if prior['status'] == 'dispatching' else (
                {'provider_confirmed', 'receipt_failed', 'receipt_unknown'} if prior['status'] == 'accepted' else
                {'pending', 'dispatching', 'accepted', 'rejected', 'unknown', 'suppressed'})
            require(new['status'] in outcomes)
        require(new['receiptError'] != 'DeviceNotRegistered')
        if new['status'] in ('dispatching', 'accepted', 'rejected', 'unknown'):
            require(new['claimedAt'] is not None and start <= stamp(new['claimedAt']) <= end
                if not prior or prior['status'] == 'pending' else new['claimedAt'] == prior['claimedAt'])
        if new['status'] == 'accepted':
            digest(new['ticketSha256'])
    return dict(newEvents=len(current)-len(old), deliveryRows=len(deliveries),
        activeStorefrontTokens=len(tokens))


def verify_protected(before, after, old_scope, new_scope):
    require(before['readOnly'] is True and after['readOnly'] is True)
    for snapshot, scope in ((before, old_scope), (after, new_scope)):
        require(abs((stamp(snapshot['capturedAt'])-stamp(scope['capturedAt'])).total_seconds()) <= 5)
        require(all(snapshot['tableRows'][name] == scope['tables'][name] for name in TABLES))
    first, second = copy.deepcopy(before), copy.deepcopy(after)
    for snapshot in (first, second):
        snapshot.pop('capturedAt')
        for name in TABLES:
            snapshot['tableRows'].pop(name)
            snapshot['allowedTargetWitnesses'].pop(name, None)
    require(first == second)
