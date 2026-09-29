"""Read-only external Tripwire feed check for GitHub Actions.

Uses the public API so it can fail when the worker is silent, even when the
worker's own alert loop cannot run. This is an operational alarm, not a
measurement of outcome quality or a guarantee that GitHub's scheduler runs.
"""

from __future__ import annotations

import math
import sys
import time
from urllib.request import Request, urlopen


METRICS_URL = "https://api-production-6a84.up.railway.app/metrics"
WATCHER_MAX_AGE = 900  # 15 minutes
REPORT_MAX_AGE = 1800  # 30 minutes, only when launch flow is active
COMMIT_MAX_AGE = 1800  # 30 minutes, only when report flow is active
MIN_1TO2H_COVERAGE = 0.5


def metric_values(body: str) -> dict[str, float]:
    values: dict[str, float] = {}
    for line in body.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or "{" in parts[0]:
            continue
        try:
            values[parts[0]] = float(parts[1])
        except ValueError:
            continue
    return values


def evaluate(body: str) -> tuple[list[str], list[str]]:
    values = metric_values(body)
    prefix = "launch_auditor_"
    required = (
        "watcher_staleness_seconds", "commit_age_seconds", "launches_24h",
        "reports_24h", "launches_due_20to40m", "det_report_age_seconds",
        "det_coverage_1to2h",
    )
    missing = [name for name in required if prefix + name not in values]
    if missing:
        return ["missing metrics: " + ", ".join(missing)], []

    def get(name: str) -> float:
        return values[prefix + name]

    problems: list[str] = []
    observations: list[str] = []
    watcher = get("watcher_staleness_seconds")
    launches = get("launches_24h")
    reports = get("reports_24h")
    launches_due = get("launches_due_20to40m")
    report_age = get("det_report_age_seconds")
    commit_age = get("commit_age_seconds")
    coverage = get("det_coverage_1to2h")
    for name, value in (("watcher age", watcher), ("launches 24h", launches),
                        ("reports 24h", reports), ("launches due 20–40m", launches_due),
                        ("commit age", commit_age)):
        if not math.isfinite(value) or value < 0:
            problems.append(f"{name} is missing or invalid: {value}")
    if not problems:
        if watcher > WATCHER_MAX_AGE:
            problems.append(f"watcher cursor is stale: {watcher:.0f}s > {WATCHER_MAX_AGE}s")
        if launches_due > 0:
            if not math.isfinite(report_age) or report_age > REPORT_MAX_AGE:
                problems.append(f"newest launch report is stale: {report_age:.0f}s > {REPORT_MAX_AGE}s")
        if math.isfinite(coverage) and coverage < MIN_1TO2H_COVERAGE:
            problems.append(f"1–2h launch report coverage is low: {coverage:.1%} < {MIN_1TO2H_COVERAGE:.0%}")
        # If the newest report is younger than the newest batch, it still
        # needs a subsequent commitment. Keep alarming until that happens.
        if math.isfinite(report_age) and report_age < commit_age and commit_age > COMMIT_MAX_AGE:
            problems.append(f"commit batch is stale: {commit_age:.0f}s > {COMMIT_MAX_AGE}s")
    observations.extend((
        f"watcher age {watcher:.0f}s",
        f"commit age {commit_age:.0f}s",
        f"launch report age {report_age:.0f}s",
        f"1–2h launch coverage {coverage:.1%}",
        f"launches due 20–40m {launches_due:.0f}",
        f"launches/reports 24h {launches:.0f}/{reports:.0f}",
    ))
    return problems, observations


def fetch_metrics() -> str:
    request = Request(METRICS_URL, headers={"User-Agent": "Tripwire-external-feed-monitor/1.0"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError(f"metrics returned HTTP {response.status}")
        body = response.read(1_000_001)
    if len(body) > 1_000_000:
        raise RuntimeError("metrics response exceeded 1 MB")
    return body.decode("utf-8")


def main() -> int:
    for attempt in range(2):
        try:
            problems, observations = evaluate(fetch_metrics())
            break
        except Exception as exc:  # transport/protocol failure is a monitor failure
            if attempt == 1:
                print(f"Tripwire metrics unavailable: {type(exc).__name__}: {exc}", file=sys.stderr)
                return 1
            time.sleep(2)
    for line in observations:
        print(line)
    for problem in problems:
        print("ALERT:", problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
