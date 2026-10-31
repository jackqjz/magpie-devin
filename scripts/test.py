#!/usr/bin/env python3
"""Run offline tests in a temporary home without reading real sign-ins."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
bun = os.environ.get("BUN_BINARY") or shutil.which("bun")
if not bun:
    raise SystemExit("Bun is required; install Bun or set BUN_BINARY to its executable.")
node = shutil.which("node")
if (root / "signed-thinking.node.mjs").exists() and not node:
    raise SystemExit("Node.js 24 or newer is required for the signed-thinking tests.")
with tempfile.TemporaryDirectory(prefix="magpie-plugin-test-") as temporary:
    home_dir = Path(temporary)
    env = os.environ.copy()
    env.update({"HOME": str(home_dir), "XDG_CONFIG_HOME": str(home_dir / "config"),
                "XDG_CACHE_HOME": str(home_dir / "cache"), "XDG_DATA_HOME": str(home_dir / "data")})
    subprocess.run([bun, "test"], cwd=root, env=env, check=True)
    if (root / "signed-thinking.node.mjs").exists():
        subprocess.run([node, "--test", "signed-thinking.node.mjs"], cwd=root, env=env, check=True)
