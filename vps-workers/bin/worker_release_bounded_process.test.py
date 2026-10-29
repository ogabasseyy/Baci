import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from worker_release_bounded_process import (
    MAX_STREAM_BYTES,
    OutputLimitExceeded,
    ProcessTimedOut,
    run_bounded_capture,
)
import worker_release_bounded_process as capture_module


class BoundedProcessCaptureTests(unittest.TestCase):
    def test_systemd_fixture_copies_bounded_runner_and_pnpm_wrapper(self):
        fixture = (Path(__file__).parents[1] / "tools" / "nonproduction-worker-release" /
                   "dependency-builder-systemd-test.sh").read_text(encoding="utf-8")
        module_list = fixture.split("for module in ", 1)[1].split("; do", 1)[0]
        self.assertIn("worker_release_bounded_process.py", module_list)
        self.assertIn("worker_release_pnpm_exec.py", module_list)

    def test_stdout_and_stderr_are_capped_and_exception_text_is_redacted(self):
        for stream in ("stdout", "stderr"):
            script = ("import sys; "
                      f"sys.{stream}.write('PRIVATE_OUTPUT=' + 'x'*4096); "
                      f"sys.{stream}.flush()")
            with self.subTest(stream=stream), self.assertRaises(OutputLimitExceeded) as caught:
                run_bounded_capture((sys.executable, "-c", script), timeout=3,
                                    max_stream_bytes=1024)
            self.assertLessEqual(len(caught.exception.stdout.encode()), 1024)
            self.assertLessEqual(len(caught.exception.stderr.encode()), 1024)
            self.assertNotIn("PRIVATE_OUTPUT", str(caught.exception))

    def test_output_limit_kills_same_process_group_descendant(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "writes"
            script = _with_descendant("sys.stdout.write('x'*8192); sys.stdout.flush(); time.sleep(60)")
            with self.assertRaises(OutputLimitExceeded):
                run_bounded_capture((sys.executable, "-c", script, str(marker)), timeout=3,
                                    max_stream_bytes=1024)
            self.assertTrue(marker.exists())
            size_after_kill = marker.stat().st_size
            time.sleep(0.1)
            self.assertEqual(marker.stat().st_size, size_after_kill)

    def test_timeout_kills_same_process_group_descendant(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "writes"
            script = _with_descendant("time.sleep(60)")
            with self.assertRaises(ProcessTimedOut):
                run_bounded_capture((sys.executable, "-c", script, str(marker)), timeout=0.2)
            self.assertTrue(marker.exists())
            size_after_kill = marker.stat().st_size
            time.sleep(0.1)
            self.assertEqual(marker.stat().st_size, size_after_kill)

    def test_success_kills_descendant_that_closed_both_stdio_streams(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "writes"
            child_code = (
                "import pathlib,sys,time\n"
                "path=pathlib.Path(sys.argv[1])\n"
                "while True:\n"
                " path.open('a').write('x')\n"
                " time.sleep(.01)\n"
            )
            script = (
                "import subprocess,sys,time; "
                f"subprocess.Popen([sys.executable,'-c',{child_code!r},sys.argv[1]], "
                "stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(.05)"
            )
            result = run_bounded_capture((sys.executable, "-c", script, str(marker)), timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(marker.exists())
            size_after_return = marker.stat().st_size
            time.sleep(0.1)
            self.assertEqual(marker.stat().st_size, size_after_return)

    def test_selector_setup_error_kills_and_reaps_started_process(self):
        class BrokenSelector:
            def register(self, *_args, **_kwargs):
                raise OSError("synthetic selector setup failure")

            def close(self):
                pass

        real_popen = subprocess.Popen
        started = []

        def track_process(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            started.append(process)
            return process

        with patch.object(capture_module.subprocess, "Popen", side_effect=track_process), \
                patch.object(capture_module.selectors, "DefaultSelector", return_value=BrokenSelector()):
            with self.assertRaisesRegex(OSError, "synthetic selector setup failure"):
                run_bounded_capture((sys.executable, "-c", "import time; time.sleep(60)"), timeout=3)
        self.assertEqual(len(started), 1)
        self.assertIsNotNone(started[0].returncode)
        self.assertEqual(started[0].wait(timeout=0), started[0].returncode)

    def test_output_limit_is_not_configurable_above_global_bound(self):
        with self.assertRaises(ValueError):
            run_bounded_capture((sys.executable, "-c", "pass"), timeout=1,
                                max_stream_bytes=MAX_STREAM_BYTES + 1)


def _with_descendant(parent_action):
    child_code = (
        "import pathlib,sys,time\n"
        "path=pathlib.Path(sys.argv[1])\n"
        "while True:\n"
        " path.open('a').write('x')\n"
        " time.sleep(.01)\n"
    )
    return (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable,'-c',{child_code!r},sys.argv[1]]); "
        f"time.sleep(.05); {parent_action}"
    )


if __name__ == "__main__":
    unittest.main()
