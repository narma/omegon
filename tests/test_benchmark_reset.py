import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "benchmark_reset.py"
SPEC = importlib.util.spec_from_file_location("benchmark_reset_module", SCRIPT)
assert SPEC and SPEC.loader
BENCHMARK_RESET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BENCHMARK_RESET
SPEC.loader.exec_module(BENCHMARK_RESET)


class BenchmarkResetTests(unittest.TestCase):
    def test_archive_runs_moves_json_files_and_writes_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            runs = root / "ai" / "benchmarks" / "runs"
            runs.mkdir(parents=True)
            (runs / "a.json").write_text('{"task_id":"a"}\n')
            (runs / "b.json").write_text('{"task_id":"b"}\n')
            (runs / "notes.txt").write_text("ignore\n")

            result = BENCHMARK_RESET.archive_runs(root)
            self.assertIsNotNone(result)
            dest, manifest = result
            self.assertTrue(dest.exists())
            self.assertEqual(manifest.file_count, 2)
            self.assertEqual(manifest.files, ["a.json", "b.json"])
            self.assertFalse((runs / "a.json").exists())
            self.assertFalse((runs / "b.json").exists())
            self.assertTrue((runs / "notes.txt").exists())
            manifest_payload = json.loads((dest / "manifest.json").read_text())
            self.assertEqual(manifest_payload["file_count"], 2)
            self.assertEqual(manifest_payload["files"], ["a.json", "b.json"])

    def test_archive_runs_returns_none_when_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "ai" / "benchmarks" / "runs").mkdir(parents=True)
            result = BENCHMARK_RESET.archive_runs(root)
            self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
