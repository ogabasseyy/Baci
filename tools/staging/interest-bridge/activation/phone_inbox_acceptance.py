from datetime import datetime
import hashlib
import json
import re
from uuid import RFC_4122, UUID
from zoneinfo import ZoneInfo


_GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
_FIELDS = {'id', 'goalId', 'type', 'title', 'body', 'createdAt'}
_TYPES = {'interest_credited', 'first_contribution', 'milestone', 'streak',
          'missed_contribution', 'weekly_summary', 'goal_completed'}
_UTC = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
                  r'(?:\.[0-9]{1,6})?(?:Z|\+00:00)$')
_CLOCK = re.compile(r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
_PREFERENCES = {'encouragementEnabled', 'interestAlertsEnabled', 'weeklySummaryEnabled',
                'quietHoursStart', 'quietHoursEnd', 'timeZone'}


def _require(condition):
    if not condition:
        raise ValueError('phone_inbox_acceptance_refused')


def _uuid(value):
    _require(type(value) is str and len(value) == 36)
    parsed = UUID(value)
    _require(str(parsed) == value and parsed.variant == RFC_4122 and parsed.version in range(1, 9))


def _time(value):
    _require(type(value) is str and len(value) <= 32 and _UTC.fullmatch(value) is not None)
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _record(record, with_read):
    _require(type(record) is dict and set(record) == _FIELDS | ({'readAt'} if with_read else set()))
    _uuid(record['id'])
    _uuid(record['goalId'])
    _require(type(record['type']) is str and record['type'] in _TYPES)
    for field, limit in (('title', 200), ('body', 1000)):
        value = record[field]
        _require(type(value) is str and 0 < len(value) <= limit and bool(value.strip()))
        value.encode('utf-8')
    created = _time(record['createdAt'])
    if with_read and record['readAt'] is not None:
        _require(_time(record['readAt']) >= created)
    return created


def _preferences(value):
    _require(type(value) is dict and set(value) == _PREFERENCES)
    for field in ('encouragementEnabled', 'interestAlertsEnabled', 'weeklySummaryEnabled'):
        _require(type(value[field]) is bool)
    for field in ('quietHoursStart', 'quietHoursEnd'):
        _require(type(value[field]) is str and _CLOCK.fullmatch(value[field]) is not None)
    _require(type(value['timeZone']) is str and 0 < len(value['timeZone']) <= 100
             and re.fullmatch(r'[A-Za-z0-9_+/-]+', value['timeZone']) is not None)
    ZoneInfo(value['timeZone'])


def verify_phone_inbox_acceptance(http_status, response, expected):
    """Match caller-supplied evidence; authentication and DB ownership must be bound externally."""
    try:
        _require(type(http_status) is int and http_status == 200)
        expected_time = _record(expected, False)
        _require(expected['goalId'] == _GOAL and expected['type'] == 'first_contribution')
        _require(type(response) is dict and set(response) ==
                 {'notifications', 'preferences', 'deliveryEnabled'})
        _require(type(response['deliveryEnabled']) is bool)
        _preferences(response['preferences'])
        rows = response['notifications']
        _require(type(rows) is list and 0 < len(rows) <= 100)
        seen, selected = set(), None
        for row in rows:
            created = _record(row, True)
            _require(row['id'] not in seen)
            seen.add(row['id'])
            if row['id'] == expected['id']:
                _require(created == expected_time and all(row[field] == expected[field]
                    for field in _FIELDS - {'createdAt'}))
                selected = row
        _require(selected is not None)
        content = {field: expected[field] for field in ('type', 'title', 'body')}
        digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':'),
                                          ensure_ascii=False).encode('utf-8')).hexdigest()
        return dict(inboxEventMatched=True, eventId=expected['id'], goalId=_GOAL,
                    contentSha256=digest, authenticatedOwnershipVerified=False,
                    deviceReceiptVerified=False, financialChangesMade=False)
    except Exception:
        raise ValueError('phone_inbox_acceptance_refused') from None
