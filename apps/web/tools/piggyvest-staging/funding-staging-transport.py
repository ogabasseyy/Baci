#!/usr/bin/env python3
"""HTTP transport for staging savings-funding verification."""

import json
import urllib.error
import urllib.request


def _request(origin, method, path, token, body=None, timeout=15):
    url = origin.rstrip('/') + path
    data = None
    headers = {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        # The staging edge challenges default scripting UAs; identify honestly.
        'User-Agent': 'baci-staging-verify/1.0',
    }
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        return error.code, _json_or_text(error.read())
    try:
        return 200, json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return 200, {'_text': raw[:200].decode('utf-8', 'replace')}


def _json_or_text(raw):
    try:
        return json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return {'_text': raw[:200].decode('utf-8', 'replace')}

