import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "provider_drift_issue.py"


class ProviderDriftIssueTests(unittest.TestCase):
    def run_script(self, log_text: str) -> dict:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "drift.log"
            out_path = Path(tmpdir) / "report.json"
            log_path.write_text(log_text)
            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--log",
                    str(log_path),
                    "--repo",
                    "styrene-lab/omegon",
                    "--run-id",
                    "123456789",
                    "--sha",
                    "abcdef1234567890",
                    "--event-name",
                    "schedule",
                    "--output",
                    str(out_path),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(out_path.read_text())

    def test_reports_clean_run_without_drift(self) -> None:
        payload = self.run_script("test result: ok. 4 passed; 0 failed; 0 ignored\n")
        self.assertFalse(payload["drift_detected"])
        self.assertEqual(payload["fingerprint"], "clean")
        self.assertIn("Drift detected: `no`", payload["summary"])

    def test_extracts_failed_tests_and_fingerprint(self) -> None:
        payload = self.run_script(
            "\n".join(
                [
                    "test live_openai_matrix ... FAILED",
                    "test live_anthropic_matrix ... FAILED",
                    "",
                    "failures:",
                    "    live_openai_matrix",
                    "    live_anthropic_matrix",
                    "",
                    "thread 'live_openai_matrix' panicked at assertion failed: expected 200 got 404",
                    "Error: upstream response schema mismatch",
                ]
            )
        )
        self.assertTrue(payload["drift_detected"])
        self.assertEqual(payload["failed_tests"], ["live_anthropic_matrix", "live_openai_matrix"])
        self.assertRegex(payload["fingerprint"], r"^[0-9a-f]{12}$")
        self.assertIn("provider-drift-fingerprint", payload["body"])
        self.assertIn("upstream response schema mismatch", payload["body"])


if __name__ == "__main__":
    unittest.main()
