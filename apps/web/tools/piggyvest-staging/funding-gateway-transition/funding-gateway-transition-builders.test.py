import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent


def _load_fixture():
    spec = importlib.util.spec_from_file_location(
        'transition_fixture', BASE / 'funding-gateway-transition-fixture.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()
validate = fixture.validate
paths = fixture.paths
render = fixture.load_registered('render')
collector = fixture.load_registered('source')


class TransitionBuildersTests(fixture.TransitionFixtureMixin, unittest.TestCase):
    def test_collect_pins_live_renewal_state(self):
        self.fixture()
        with patch.object(paths, '_safe_ancestors'):
            source = collector.collect_transition_source(
                self.state, self.gateway_unit, os.getuid()
            )
        self.assertEqual(source['preRenewalManifestSha256'], 'a' * 64)
        self.assertEqual(source['archive']['name'], 'approved-renewal')
        self.assertEqual(
            source['archive']['bindingSha256'], paths._sha(b'binding')
        )
        self.assertEqual(
            source['archive']['startupEvidenceSha256'],
            paths._sha(b'startup'),
        )
        self.assertEqual(
            source['unitSha256'],
            paths._sha(b'post-renewal gateway unit'),
        )


    def test_collect_refuses_ambiguous_or_mismatched_archive(self):
        self.fixture()
        (self.state / 'renewals' / 'second').mkdir()
        with patch.object(paths, '_safe_ancestors'):
            with self.assertRaisesRegex(validate.Refused, 'exactly one'):
                collector.collect_transition_source(
                    self.state, self.gateway_unit, os.getuid()
                )
        (self.state / 'renewals' / 'second').rmdir()
        (self.archive / 'binding.json').chmod(0o600)
        (self.archive / 'binding.json').write_bytes(b'tampered')
        (self.archive / 'binding.json').chmod(0o440)
        with patch.object(paths, '_safe_ancestors'):
            with self.assertRaisesRegex(validate.Refused, 'does not match'):
                collector.collect_transition_source(
                    self.state, self.gateway_unit, os.getuid()
                )


    def test_builder_round_trip_passes_preflight(self):
        self.fixture()
        with patch.object(paths, '_safe_ancestors'):
            source = collector.collect_transition_source(
                self.state, self.gateway_unit, os.getuid()
            )
        post_renewal = render.render_post_renewal_manifest(
            source['unitSha256']
        )
        self.write(self.manifest_path, post_renewal)
        package_sha = paths._sha(self.package_path.read_bytes())
        post_sha = paths._sha(self.manifest_path.read_bytes())
        generated = render.render_owner_inputs(source, package_sha, post_sha)
        self.write(self.inputs_path, generated)
        with patch.object(paths, '_safe_ancestors'):
            preflight = validate.validate_preflight(
                self.inputs_path,
                self.state,
                self.manifest_path,
                self.gateway_unit,
                os.getuid(),
                validate.DEADLINE_EPOCH - 1,
                self.package_path,
            )
        self.assertEqual(
            preflight['identity']['restRoutes'],
            self.inputs()['identity']['restRoutes'],
        )
        self.assertEqual(preflight['deadline'], validate.DEADLINE)


if __name__ == '__main__':
    unittest.main()
