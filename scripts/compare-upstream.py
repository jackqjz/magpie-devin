#!/usr/bin/env python3
"""Fetch upstream into review refs and print differences; never merge or install."""
from pathlib import Path
import json
import re
import subprocess

root = Path(__file__).resolve().parents[1]
metadata = json.loads((root / "UPSTREAM.json").read_text())
baseline = metadata["commit"]
if not re.fullmatch(r"[0-9a-f]{40}", baseline):
    raise SystemExit("UPSTREAM.json must contain a complete baseline commit SHA.")
repository = metadata["repository"]
branch = metadata["branch"]
prefix = metadata["directory"].strip("/")
prefix = prefix + "/" if prefix else ""
baseline_ref = "refs/upstream-review/baseline"
latest_ref = "refs/upstream-review/latest"

def run(*args, capture=False):
    return subprocess.run(["git", *args], cwd=root, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None)

# Only these review refs are moved. The working tree, main, tags and installation stay untouched.
run("fetch", "--no-tags", "--depth=1", repository, "+" + baseline + ":" + baseline_ref)
run("fetch", "--no-tags", "--depth=1", repository, "+refs/heads/" + branch + ":" + latest_ref)
latest = run("rev-parse", latest_ref, capture=True).stdout.strip()
print("Baseline:", baseline, flush=True)
print("Upstream:", latest, flush=True)
print("\nUpstream changes since the recorded baseline:", flush=True)
run("--no-pager", "diff", "--stat", baseline_ref, latest_ref, "--", prefix or ".")
run("--no-pager", "diff", baseline_ref, latest_ref, "--", prefix or ".")
print("\nThis fork's committed runtime compared with current upstream:", flush=True)
run("--no-pager", "diff", latest_ref + ":" + prefix + "index.mjs", "HEAD:index.mjs")
print("\nReview only: no merge, push, release or installation was performed.")
