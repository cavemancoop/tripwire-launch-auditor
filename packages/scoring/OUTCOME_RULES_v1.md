# Outcome rules v1

Verbatim from launch-auditor-spec-v0.2.md §1 / §1.1. The keccak256 of this file
is committed on-chain (ArtifactCommitted, kind = keccak256("outcome_rule"))
before the first live report. Changes apply only to reports issued after the
change's effective block.

| Label | Definition | Horizons | Applies to |
|---|---|---|---|
| `INSIDER_EXIT` | Creator cluster (§3.2) net-sells ≥ 50% of its peak token holdings | 6h, 24h, 72h | all |
| `SELL_IMPAIRED` | A fixed-size sell simulation reverts or effective sell tax ≥ 30% at the horizon check | 1h, 24h | non-launchpad tokens (launchpad tokens: always false, reported as N/A) |
| `LIQ_IMPAIRED` | Primary pool liquidity ≤ 20% of its post-launch peak via removal transactions | 24h, 7d | non-launchpad tokens (launchpad LP is locked by construction) |
| `DRAWDOWN_80` | Price ≤ 20% of the maximum observed in the first 24h, measured at the horizon | 24h, 7d | all |
| `TRADING_ALIVE` | At least one trade for the primary pool in the 6h ending at the horizon (M4e) | 24h, 7d | all |

`DRAWDOWN_80` is a drawdown, not an accusation. The word "rug" does not appear in report fields.

`TRADING_ALIVE` is the one **positive** outcome — `value = true` means the token
was still trading near the horizon. The published probability is `P(still
trading)`. It answers the research finding that most launches stop trading the
day they launch, and is what launchpads and aggregators rank on.

All horizons are measured from `reportTime`, not from launch. `DRAWDOWN_80` for
non-launch reports uses the maximum price in the 24h before `reportTime` as its
reference.
