/** The fifth operational check: changes in the budgeted worker transport's
 * cumulative counters. The default alert interval is one minute. No traffic
 * is unknown, never proof that a provider outage recovered. */
import type { RpcWireStats } from '@launch-auditor/rpc-budget';

export interface ProviderHealthCheck {
  bad: boolean;
  detail: string;
}

const ZERO: RpcWireStats = { attempts: 0, providerFailures: 0, quotaFailures: 0 };
const ERROR_RATE_LIMIT = 0.05;

export class ProviderHealthTracker {
  private previous = { ...ZERO };
  private bad = false;
  private healthyWindows = 0;
  private lastDetail = 'provider failure threshold exceeded';

  sample(current: RpcWireStats): ProviderHealthCheck | null {
    const values = [current.attempts, current.providerFailures, current.quotaFailures];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        current.attempts < this.previous.attempts ||
        current.providerFailures < this.previous.providerFailures ||
        current.quotaFailures < this.previous.quotaFailures ||
        current.providerFailures > current.attempts ||
        current.quotaFailures > current.providerFailures) {
      // A counter reset or invalid sample must not produce a recovery.
      this.previous = { ...current };
      this.healthyWindows = 0;
      return null;
    }
    const attempts = current.attempts - this.previous.attempts;
    const failures = current.providerFailures - this.previous.providerFailures;
    const quota = current.quotaFailures - this.previous.quotaFailures;
    this.previous = { ...current };

    if (attempts === 0) {
      return this.bad ? { bad: true, detail: `${this.lastDetail}; no new RPC attempts` } : null;
    }
    const rate = failures / attempts;
    if (quota > 0 || rate > ERROR_RATE_LIMIT) {
      this.bad = true;
      this.healthyWindows = 0;
      this.lastDetail = `${quota} quota refusals; ${failures}/${attempts} budgeted RPC attempts failed (${(100 * rate).toFixed(1)}%, threshold 5%)`;
      return { bad: true, detail: this.lastDetail };
    }
    if (++this.healthyWindows < 2) {
      return this.bad ? { bad: true, detail: `${this.lastDetail}; one healthy traffic window observed` } : null;
    }
    this.bad = false;
    return { bad: false, detail: `${failures}/${attempts} budgeted RPC attempts failed in latest window; two healthy windows observed` };
  }
}
