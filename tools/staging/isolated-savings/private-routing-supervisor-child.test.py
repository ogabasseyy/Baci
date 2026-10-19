import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("child", Path(__file__).with_name("private-routing-supervisor-child.py"))
child = importlib.util.module_from_spec(spec)
spec.loader.exec_module(child)


class ParentDeathTests(unittest.TestCase):
    def execute(self, parents, result=0, capabilities=False):
        library = Mock()
        library.prctl.return_value = result
        with patch.object(child.sys, "platform", "linux"), patch.object(child.os, "geteuid", return_value=1000), patch.object(child.os, "getppid", side_effect=parents), patch.object(child.os, "stat", return_value=SimpleNamespace(st_uid=0, st_mode=0o100755)), patch.object(child.os, "lstat", return_value=SimpleNamespace(st_uid=1000, st_mode=0o40700)), patch.object(child.os, "getxattr", create=True, side_effect=None if capabilities else OSError(child.errno.ENODATA, "missing"), return_value=b"capabilities"), patch.object(child.ctypes, "CDLL", return_value=library), patch.object(child.os, "execve") as execute:
            if result or parents[-1] != 42 or capabilities:
                with self.assertRaises(RuntimeError):
                    child.launch(["42", "/tmp/private", "--serve"])
                execute.assert_not_called()
            else:
                child.launch(["42", "/tmp/private", "--serve"])
                self.assertEqual(execute.call_args.args[0], "/usr/sbin/nginx")
                self.assertEqual(execute.call_args.args[2], {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"})
            if parents[0] == 42 and not capabilities:
                library.prctl.assert_called_once_with(1, child.signal.SIGKILL, 0, 0, 0)

    def test_parent_death_guard_precedes_exec(self):
        self.execute([42, 42])

    def test_parent_exit_before_or_after_guard_refuses_exec(self):
        self.execute([1])
        self.execute([42, 1])

    def test_failed_guard_refuses_exec(self):
        self.execute([42], -1)

    def test_capabilities_cannot_clear_parent_death_guard(self):
        self.execute([42, 42], capabilities=True)

    def test_root_is_refused(self):
        with patch.object(child.sys, "platform", "linux"), patch.object(child.os, "geteuid", return_value=0):
            with self.assertRaises(RuntimeError):
                child.launch(["42", "/tmp/private", "--serve"])


if __name__ == "__main__":
    unittest.main()
