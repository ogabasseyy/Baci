#!/usr/bin/env python3
"""Shared fixture for gateway transition module tests."""

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent


def load_registered(name):
    key = f'funding_gateway_transition_{name}'
    cached = sys.modules.get(key)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(
        key, BASE / f'funding-gateway-transition-{name}.py'
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


validate = load_registered('validate')
paths = validate._paths


class TransitionFixtureMixin:
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.state = self.root / 'state'
        self.archive = self.state / 'renewals/approved-renewal'
        self.archive.mkdir(parents=True)
        self.inputs_path = self.root / 'inputs.json'
        self.manifest_path = self.root / 'post-renewal-manifest.json'
        self.package_path = self.root / 'funding-transition-package-manifest.json'
        self.gateway_unit = self.root / 'baci-savings-gateway.service'


    def tearDown(self):
        self.directory.cleanup()


    def write(self, path, value):
        path.write_text(json.dumps(value), encoding='utf-8')
        path.chmod(0o600)


    def inputs(self):
        return {
            'version': 1,
            'deadline': validate.DEADLINE,
            'preRenewalManifestSha256': 'a' * 64,
            'postRenewalManifestSha256': 'b' * 64,
            'packageManifestSha256': 'c' * 64,
            'archive': {
                'name': 'approved-renewal',
                'bindingSha256': paths._sha(b'binding'),
                'startupEvidenceSha256': paths._sha(b'startup'),
            },
            'identity': {
                'restRoutes': [
                    {'path': path, 'methods': list(methods)}
                    for path, methods in validate.ROUTES
                ]
            },
        }


    def fixture(self):
        inputs = self.inputs()
        receipt = {
            'version': 1,
            'manifestSha256': inputs['preRenewalManifestSha256'],
            'entries': [],
        }
        receipt_bytes = json.dumps(receipt).encode()
        self.write(self.state / 'receipt.json', receipt)
        self.write(
            self.state / 'renewal-receipt.json',
            {
                'version': 1,
                'activatedAt': 1790092750,
                'expiresAt': 1790697550,
                'predecessorReceiptSha256': paths._sha(receipt_bytes),
                'archivedEvidence': {
                    'bindingSha256': inputs['archive']['bindingSha256'],
                    'startupEvidenceSha256': inputs['archive']['startupEvidenceSha256'],
                },
            },
        )
        for leaf in ('binding.json', 'startup-evidence.json'):
            (self.archive / leaf).unlink(missing_ok=True)
        (self.archive / 'binding.json').write_bytes(b'binding')
        (self.archive / 'startup-evidence.json').write_bytes(b'startup')
        for path in self.archive.iterdir():
            path.chmod(0o440)
        self.write(self.inputs_path, inputs)
        if self.gateway_unit.exists():
            self.gateway_unit.chmod(0o600)
        self.gateway_unit.write_bytes(b'post-renewal gateway unit')
        self.gateway_unit.chmod(0o444)
        self.write(
            self.manifest_path,
            {
                'version': 1,
                'files': {
                    'managed-gateway.service': paths._sha(self.gateway_unit.read_bytes())
                },
            },
        )
        inputs['postRenewalManifestSha256'] = paths._sha(self.manifest_path.read_bytes())
        self.write(self.package_path, {'reviewed': 'package'})
        inputs['packageManifestSha256'] = paths._sha(self.package_path.read_bytes())
        self.write(self.inputs_path, inputs)
        return inputs


    def preflight(self):
        with patch.object(paths, '_safe_ancestors'):
            return validate.validate_preflight(
                self.inputs_path,
                self.state,
                self.manifest_path,
                self.gateway_unit,
                os.getuid(),
                validate.DEADLINE_EPOCH - 1,
                self.package_path,
            )



def stat_result(original, uid):
    return type('Metadata', (), {
        'st_mode': original.st_mode,
        'st_uid': uid,
        'st_nlink': original.st_nlink,
        'st_size': original.st_size,
        'st_dev': original.st_dev,
        'st_ino': original.st_ino,
        'st_mtime_ns': original.st_mtime_ns,
        'st_ctime_ns': original.st_ctime_ns,
    })()


