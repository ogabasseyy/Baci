from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_egress_identity_provision as provision


class EgressIdentityProvisionTests(unittest.TestCase):
    def test_absent_account_is_created_with_fixed_nonlogin_identity(self):
        group = SimpleNamespace(gr_gid=321)
        commands = []
        runner = lambda command, **_kwargs: commands.append(command)
        with (patch.object(provision.os, "geteuid", return_value=0),
              patch.object(provision, "_group_state", side_effect=[None, group]),
              patch.object(provision, "_user_state", side_effect=[None, None]),
              patch.object(provision, "_validate_empty_group"),
              patch.object(provision, "egress_identity", return_value=(123, 321))):
            self.assertEqual(provision.ensure_egress_identity(runner=runner), (123, 321))
        self.assertEqual(commands, [
            ("groupadd", "--system", "baci-worker-egress-bridge"),
            ("useradd", "--system", "--gid", "baci-worker-egress-bridge",
             "--home-dir", "/nonexistent", "--no-create-home", "--shell",
             "/usr/sbin/nologin", "baci-worker-egress-bridge"),
        ])

    def test_exact_empty_group_prefix_resumes_without_recreation(self):
        group = SimpleNamespace(gr_gid=321)
        with (patch.object(provision.os, "geteuid", return_value=0),
              patch.object(provision, "_group_state", return_value=group),
              patch.object(provision, "_user_state", return_value=None),
              patch.object(provision, "_validate_empty_group"),
              patch.object(provision, "egress_identity", return_value=(123, 321)),
              patch.object(provision, "subprocess") as subprocess_module):
            provision.ensure_egress_identity(runner=subprocess_module.run)
        subprocess_module.run.assert_called_once()
        self.assertEqual(subprocess_module.run.call_args.args[0][0], "useradd")

    def test_user_without_group_is_rejected_without_mutation(self):
        commands = []
        with (patch.object(provision.os, "geteuid", return_value=0),
              patch.object(provision, "_group_state", return_value=None),
              patch.object(provision, "_user_state", return_value=object())):
            with self.assertRaisesRegex(provision.EgressProvisionRejected, "without its dedicated group"):
                provision.ensure_egress_identity(runner=lambda command, **_kw: commands.append(command))
        self.assertEqual(commands, [])

    def test_nonroot_cannot_provision_account(self):
        with patch.object(provision.os, "geteuid", return_value=1000):
            with self.assertRaisesRegex(provision.EgressProvisionRejected, "requires root"):
                provision.ensure_egress_identity()


if __name__ == "__main__":
    unittest.main()
