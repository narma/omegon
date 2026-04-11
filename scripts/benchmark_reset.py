#!/usr/bin/env python3
"""Archive active local benchmark run artifacts and reset the active runs dir.

This script is intentionally conservative:
- it only moves JSON result artifacts from ai/benchmarks/runs/
- it writes a manifest.json alongside the archived files
- it recreates an empty runs/ directory after archival

Historical findings belong in docs/. Local run artifacts are disposable evidence.
"""

from __future__ import annotations

import json
import shutil
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class ArchiveManifest:
    archived_at: str
    source_dir: str
    destination_dir: str
    file_count: int
    files: list[str]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def archive_runs(root: Path) -> tuple[Path, ArchiveManifest] | None:
    runs_dir = root / "ai" / "benchmarks" / "runs"
    archive_root = root / "ai" / "benchmarks" / "archive"
    runs_dir.mkdir(parents=True, exist_ok=True)
    archive_root.mkdir(parents=True, exist_ok=True)

    files = sorted(path.name for path in runs_dir.glob("*.json") if path.is_file())
    if not files:
        return None

    stamp = utc_stamp()
    dest = archive_root / stamp
    dest.mkdir(parents=True, exist_ok=False)

    for name in files:
        shutil.move(str(runs_dir / name), str(dest / name))

    manifest = ArchiveManifest(
        archived_at=stamp,
        source_dir=str(runs_dir.relative_to(root)),
        destination_dir=str(dest.relative_to(root)),
        file_count=len(files),
        files=files,
    )
    (dest / "manifest.json").write_text(json.dumps(asdict(manifest), indent=2) + "\n")
    runs_dir.mkdir(parents=True, exist_ok=True)
    return dest, manifest


def main() -> int:
    root = repo_root()
    result = archive_runs(root)
    if result is None:
        print("No benchmark run artifacts to archive.")
        return 0
    dest, manifest = result
    print(f"Archived {manifest.file_count} benchmark run artifact(s) to {dest.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
