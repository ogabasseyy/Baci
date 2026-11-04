import json
import shlex
import unittest
from unittest.mock import patch

from staging_keys import credentials, save_command
import staging_keys


class StagingKeysTest(unittest.TestCase):
    def test_credentials_require_both_values(self):
        for value in ('{}', '[]', '{"reference":"x","secret":""}'):
            with self.assertRaises(ValueError):
                credentials(value)

    def test_secret_remains_literal_in_keychain_input(self):
        value = json.dumps({"reference": "example", "secret": "quote' $() `text`\nline"})
        parts = shlex.split(save_command(value))
        self.assertEqual(parts[-1], value)
        self.assertEqual(parts[0], "add-generic-password")
        self.assertEqual(credentials(value)["reference"], "example")

    def test_form_reuses_saved_keys_and_pins_staging(self):
        saved = {"reference": "example-ref", "secret": "example-secret"}
        with patch.object(staging_keys.sys, "platform", "darwin"), patch.object(
            staging_keys.sys, "argv", ["staging_keys.py", "form"]
        ), patch.object(staging_keys, "load", return_value=saved), patch.object(
            staging_keys.os, "chdir"
        ), patch.object(staging_keys.os, "execvpe") as execute:
            staging_keys.main()
        _, command, environment = execute.call_args.args
        self.assertEqual(command[-1], "--staging")
        self.assertEqual(environment["OXYGEN_TEST_SECRET"], saved["secret"])
        self.assertNotIn(saved["secret"], command)

    def test_missing_saved_keys_never_launches_provider_tool(self):
        with patch.object(staging_keys.sys, "platform", "darwin"), patch.object(
            staging_keys.sys, "argv", ["staging_keys.py", "form"]
        ), patch.object(staging_keys, "load", side_effect=ValueError()), patch.object(
            staging_keys.os, "execvpe"
        ) as execute:
            with self.assertRaises(ValueError):
                staging_keys.main()
        execute.assert_not_called()

    def test_update_requires_explicit_launcher_mode(self):
        with patch.object(staging_keys.sys, "platform", "darwin"), patch.object(
            staging_keys.sys, "argv", ["staging_keys.py", "webhook-update", "https://receiver.trycloudflare.com/oxygen-staging-hook"]
        ), patch.object(staging_keys, "load", return_value={"reference": "example", "secret": "private"}), patch.object(
            staging_keys.os, "chdir"
        ), patch.object(staging_keys.os, "execvpe") as execute:
            staging_keys.main()
        self.assertEqual(execute.call_args.args[1][-1], "--update")


if __name__ == "__main__":
    unittest.main()
