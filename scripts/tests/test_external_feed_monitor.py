import unittest

from scripts.external_feed_monitor import evaluate


def metrics(watcher=2, commit=120, launches=9000, reports=29000, launches_due=100, report_age=30, coverage=1):
    return "\n".join(f"launch_auditor_{key} {value}" for key, value in {
        "watcher_staleness_seconds": watcher,
        "commit_age_seconds": commit,
        "launches_24h": launches,
        "reports_24h": reports,
        "launches_due_20to40m": launches_due,
        "det_report_age_seconds": report_age,
        "det_coverage_1to2h": coverage,
    }.items())


class ExternalFeedMonitorTests(unittest.TestCase):
    def test_healthy_active_feed(self):
        self.assertEqual(evaluate(metrics())[0], [])

    def test_worker_silence_even_if_api_still_responds(self):
        problems, _ = evaluate(metrics(watcher=1000, commit=2000, report_age=2000, coverage=0.2))
        self.assertEqual(len(problems), 3)

    def test_recent_report_without_commit_alarms(self):
        problems, _ = evaluate(metrics(commit=2000, report_age=30))
        self.assertEqual(len(problems), 1)
        self.assertIn("commit batch", problems[0])

    def test_uncommitted_report_stays_alarmable_after_it_ages(self):
        problems, _ = evaluate(metrics(launches_due=0, commit=2700,
                                       report_age=2100, coverage=1))
        self.assertEqual(len(problems), 1)
        self.assertIn("commit batch", problems[0])

    def test_quiet_chain_does_not_require_new_reports_or_commits(self):
        self.assertEqual(evaluate(metrics(launches=0, reports=0, launches_due=0, report_age=float("nan"), commit=2000, coverage=float("nan")))[0], [])

    def test_earlier_burst_followed_by_quiet_hour_does_not_alarm(self):
        self.assertEqual(evaluate(metrics(launches=101, reports=101, launches_due=0,
                                          report_age=3600, commit=3600,
                                          coverage=float("nan")))[0], [])

    def test_missing_or_invalid_metric_fails_closed(self):
        self.assertIn("missing metrics", evaluate(metrics().replace("launch_auditor_reports_24h", "other"))[0][0])
        self.assertTrue(evaluate(metrics(watcher=float("nan")))[0])


if __name__ == "__main__":
    unittest.main()
