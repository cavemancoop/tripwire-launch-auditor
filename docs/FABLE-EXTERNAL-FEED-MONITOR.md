# External feed-silence monitor

The [Tripwire external feed monitor](https://github.com/cavemancoop/tripwire-launch-auditor/actions/workflows/tripwire-feed-monitor.yml)
checks the public API's `/metrics` from GitHub Actions every 15 minutes at
minute 7, 22, 37 and 52 UTC. It also supports a manual **Run workflow** check.
This runs outside the Railway worker, so a stopped worker cannot silence this
check by stopping its own alert loop. It makes one public read, with one retry
on transport failure, and does not use an API key or write to production.

The workflow fails when the API or required metrics are unavailable, the
watcher cursor is over 15 minutes stale, the newest launch report is over 30
minutes old while at least one launch from 20–40 minutes ago exists,
the commit batch is over 30 minutes old and the newest launch report was
written after that batch, or 1–2h launch report coverage falls below 50%. Those
thresholds are operational alarms, not outcome-quality gates. A quiet chain
can have no new report or commit without being unhealthy; the watcher age
still applies.
The workflow log prints each observed value so an operator can tell what
failed. Failed runs are visible in the repository's Actions tab. To receive
email or web alerts, the repository owner must [enable GitHub Actions
notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)
and may choose **Only notify for failed workflows**.

This is a best-effort external check, not a paging guarantee. GitHub says
scheduled runs [can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
and public-repository schedules can be [disabled after 60 days without
activity](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).
`watcher_staleness_seconds` measures cursor recency, not chain-head lag; the
report-age and coverage checks cover some of that blind spot but cannot prove
every launch was detected. Keep the worker's internal alerts and production
health observation as separate safeguards. The Actions run history itself
should be checked during the seven-day observation window.

Local dry run: `python3 -m unittest discover -s scripts/tests -p
test_external_feed_monitor.py`, then `python3 scripts/external_feed_monitor.py`
for a read-only live check.
