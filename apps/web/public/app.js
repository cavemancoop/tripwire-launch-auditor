// M8 dashboard — no build step, no framework. Every number here either comes
// straight off an api response or is a transparently-labelled derivation from
// one (credits/hr, spend/report, rotation counts); nothing is invented when
// data is missing — those cases render "n/a" or an explicit note instead.

const EXPLORER_BASE = 'https://robinhoodchain.blockscout.com';
const LS_KEY = 'launch-auditor:api-base';

function defaultApiBase() {
  return `${location.protocol}//${location.hostname}:3000`;
}

function getApiBase() {
  try {
    return localStorage.getItem(LS_KEY) || defaultApiBase();
  } catch {
    return defaultApiBase();
  }
}

function setApiBase(v) {
  try {
    localStorage.setItem(LS_KEY, v);
  } catch {
    /* private-browsing / storage blocked — the input still works for this load */
  }
}

async function getJson(path) {
  const res = await fetch(`${getApiBase()}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const usd = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : `$${v.toFixed(digits)}`);
const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'n/a');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'n/a');

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children || []) node.appendChild(c);
  return node;
}

function billingBadge(status) {
  const cls = status === 'anomaly' || status === 'phantom' ? 'bad' : status === 'unavailable' ? 'warn' : status === 'exact' ? 'good' : 'dim';
  return `<span class="badge ${cls}">${status ?? 'n/a'}</span>`;
}

// ── Metabolism ───────────────────────────────────────────────────────────

function metric(label, value, sub) {
  return el('div', { class: 'metric' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    ...(sub ? [el('div', { class: 'sub', text: sub })] : []),
  ]);
}

function creditsAccruedPerHour(entries) {
  if (entries.length < 2) return null;
  let accrued = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const d = (entries[i].balanceUsd ?? 0) - (entries[i - 1].balanceUsd ?? 0);
    if (d > 0) accrued += d; // a drop means the balance was spent into a key, not un-accrued
  }
  const spanMs = new Date(entries[entries.length - 1].at).getTime() - new Date(entries[0].at).getTime();
  const hours = spanMs / 3_600_000;
  if (hours <= 0) return null;
  return { perHour: accrued / hours, hours };
}

function renderMetabolism(lifecycle) {
  const { entries, estimator, budget } = lifecycle;
  const latest = entries[entries.length - 1];
  const grid = document.getElementById('metabolism-metrics');
  grid.innerHTML = '';

  const accrual = creditsAccruedPerHour(entries);
  const rotations = entries.filter((e) => e.newState === 'ROTATING').length;
  const revocations = entries.filter((e) => e.newState === 'REVOKING').length;
  const spendPerReport = estimator.requests24h > 0 ? estimator.estimatedSpend24hUsd / estimator.requests24h : null;

  grid.appendChild(metric('Active key remaining', usd(latest?.keyRemainingUsd ?? null), latest?.keyHashPrefix ? `key ${latest.keyHashPrefix}` : 'no key claimed'));
  grid.appendChild(metric('Credits accrued', accrual ? `${usd(accrual.perHour)}/hr` : 'n/a', accrual ? `over ${accrual.hours.toFixed(1)}h of samples` : 'not enough samples yet'));
  grid.appendChild(metric('Spend per report', spendPerReport !== null ? usd(spendPerReport, 4) : 'n/a', `${estimator.requests24h} requests, trailing 24h`));
  grid.appendChild(metric('Rotations', String(rotations), `${revocations} revocation${revocations === 1 ? '' : 's'}`));
  grid.appendChild(metric('Billing status', latest?.billingStatus ?? 'n/a', estimator.meanAbsDiscrepancyPct !== null ? `mean |discrepancy| ${estimator.meanAbsDiscrepancyPct}%` : 'no reconciled epochs yet'));

  const b = budget;
  document.getElementById('budget-body').innerHTML = `
    <div class="kv"><span class="k">daily cap</span><span class="v">${usd(b.dailyCapUsd)}</span></div>
    <div class="kv"><span class="k">spent, trailing 24h</span><span class="v">${usd(b.spentTrailing24hUsd)}</span></div>
    <div class="kv"><span class="k">remaining today</span><span class="v">${usd(b.remainingTodayUsd)}</span></div>
    <div class="kv"><span class="k">spendable on key</span><span class="v">${usd(b.spendableKeyUsd)}</span></div>
    <div class="kv"><span class="k">next run allows up to</span><span class="v">${usd(b.maxRunCostUsd)}</span></div>
    <div class="kv"><span class="k">binding constraint</span><span class="v">${b.bindingConstraint}</span></div>
    ${b.gateClosedByBilling ? '<p class="note" style="color:var(--bad)">Gate closed — billing status is anomaly or phantom.</p>' : ''}
  `;

  const check = { verified: lifecycle.verified, startsAtGenesis: lifecycle.startsAtGenesis, brokenAt: lifecycle.brokenAt };
  const spanMs = entries.length ? new Date(entries[entries.length - 1].at).getTime() - new Date(entries[0].at).getTime() : 0;
  const spanDays = spanMs / 86_400_000;
  document.getElementById('continuity-body').innerHTML = `
    <div class="kv"><span class="k">chain verified</span><span class="v">${check.verified ? 'yes' : 'BROKEN at ' + check.brokenAt}</span></div>
    <div class="kv"><span class="k">starts at genesis</span><span class="v">${check.startsAtGenesis ? 'yes' : 'no'}</span></div>
    <div class="kv"><span class="k">log span held</span><span class="v">${spanDays.toFixed(2)} days (${entries.length} rows)</span></div>
    <p class="note">Without a working OAuth refresh grant, unattended continuity is bounded by the access token's own lifetime, not by this log's span — see CHANGELOG.md. This number describes what the signed log currently covers, not a guarantee of what comes next.</p>
  `;
}

// ── P&L ──────────────────────────────────────────────────────────────────

function renderPnl(lifecycle) {
  const { estimator } = lifecycle;
  const wouldHaveCost = Math.max(estimator.providerSpend24hUsd, estimator.estimatedSpend24hUsd);

  const standalone = document.querySelector('#pnl-standalone .pnl-body');
  standalone.innerHTML = `
    <div class="big neg">${usd(-wouldHaveCost)}</div>
    <div class="kv"><span class="k">revenue (free during contest)</span><span class="v">$0.00</span></div>
    <div class="kv"><span class="k">compute, cash-priced</span><span class="v">${usd(wouldHaveCost)}</span></div>
    <p class="note">What the trailing-24h LLM deep-dives would have cost on a plain OpenRouter account with no Orbio credits — the standing red-team check from spec &sect;0.1.</p>
  `;

  const orbio = document.querySelector('#pnl-orbio .pnl-body');
  orbio.innerHTML = `
    <div class="big zero">$0.00</div>
    <div class="kv"><span class="k">revenue (free during contest)</span><span class="v">$0.00</span></div>
    <div class="kv"><span class="k">cash spent</span><span class="v">$0.00</span></div>
    <p class="note">Same compute, actually run: ${estimator.requests24h} request${estimator.requests24h === 1 ? '' : 's'} in the trailing 24h, paid entirely from the agent's Orbio-funded key. The agent never held or converted money to make this happen.</p>
  `;
}

// ── Live launches ────────────────────────────────────────────────────────

function proofCell(proof) {
  if (!proof || !proof.committed) return '<span class="badge dim">not committed</span>';
  if (!proof.txHash) return '<span class="badge warn">committed, no tx yet</span>';
  return `<a href="${EXPLORER_BASE}/tx/${proof.txHash}" target="_blank" rel="noopener">tx ↗</a>`;
}

function renderLaunches(rows) {
  const body = document.getElementById('launches-body');
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty">no launches yet</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((l) => {
      const d = l.detV0 || {};
      return `<tr>
        <td>${short(l.token)}</td>
        <td>${l.source}</td>
        <td>${l.lane}</td>
        <td>${fmtDate(l.launchAt)}</td>
        <td>${pct(d.pInsiderExit24h)}</td>
        <td>${pct(d.pDrawdown8024h)}</td>
        <td>${pct(d.pTradingAlive24h)}</td>
        <td>${proofCell(l.proof)}</td>
      </tr>`;
    })
    .join('');
}

// ── Benchmark ────────────────────────────────────────────────────────────

function cellKey(outcome, forecaster) {
  return `${outcome}‖${forecaster}`;
}

function indexLiveCells(liveBenchmark) {
  const idx = new Map();
  const section = liveBenchmark.sections.find((s) => s.splitBy === 'all');
  for (const [outcome, cells] of Object.entries(section?.byOutcome ?? {})) {
    for (const c of cells) idx.set(cellKey(outcome, c.forecaster), c.n);
  }
  return idx;
}

function renderBenchmark(snapshot) {
  const wrap = document.getElementById('benchmark-wrap');
  const all = snapshot.all.sections.find((s) => s.splitBy === 'all');
  document.getElementById('min-metrics').textContent = String(snapshot.all.minForMetrics);
  document.getElementById('min-claims').textContent = String(snapshot.all.minForClaims);
  if (!all) {
    wrap.innerHTML = '<p class="empty">no resolved outcomes yet</p>';
    return;
  }
  const liveN = indexLiveCells(snapshot.live);

  const rows = [];
  for (const [outcome, cells] of Object.entries(all.byOutcome)) {
    for (const c of cells) {
      const liveCount = liveN.get(cellKey(outcome, c.forecaster)) ?? 0;
      const retro = Math.max(0, c.n - liveCount);
      const claim = c.comparisons?.find((x) => x.claimAllowed);
      rows.push(`<tr>
        <td>${outcome}</td>
        <td>${c.forecaster}</td>
        <td>${c.n}${retro > 0 ? ` <span class="badge dim">+${retro} retro</span>` : ''}${c.insufficientSample ? ' <span class="badge warn">insufficient</span>' : ''}</td>
        <td>${c.positives}</td>
        <td>${c.auroc === null ? 'n/a' : c.auroc.toFixed(3)}</td>
        <td>${c.brierSkill === null ? 'n/a' : c.brierSkill.toFixed(3)}</td>
        <td>${claim ? `<span class="badge good">beats ${claim.vs} p=${claim.p}</span>` : ''}</td>
      </tr>`);
    }
  }

  wrap.innerHTML = `<table>
    <thead><tr><th>outcome</th><th>forecaster</th><th>n</th><th>positives</th><th>auroc</th><th>brier skill</th><th></th></tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="7" class="empty">no cells yet</td></tr>'}</tbody>
  </table>`;
}

// ── Lifecycle timeline ───────────────────────────────────────────────────

function renderLifecycle(lifecycle) {
  const { entries } = lifecycle;
  document.getElementById('chain-status').textContent =
    `${entries.length} rows · chain ${lifecycle.verified ? 'verified' : 'BROKEN at ' + lifecycle.brokenAt} · genesis ${lifecycle.startsAtGenesis ? 'yes' : 'no'}`;

  const body = document.getElementById('lifecycle-body');
  const recent = entries.slice(-30).reverse();
  if (recent.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">no lifecycle rows yet</td></tr>';
    return;
  }
  body.innerHTML = recent
    .map(
      (e) => `<tr>
        <td>${fmtDate(e.at)}</td>
        <td>${e.prevState ?? '—'} → <strong>${e.newState}</strong></td>
        <td style="white-space:normal;font-family:var(--sans)">${e.reason ?? ''}</td>
        <td>${usd(e.balanceUsd)}</td>
        <td>${usd(e.keyRemainingUsd)}</td>
        <td>${billingBadge(e.billingStatus)}</td>
      </tr>`,
    )
    .join('');
}

// ── Boot ─────────────────────────────────────────────────────────────────

async function loadAll() {
  const statusDot = document.getElementById('api-status');
  try {
    const [lifecycle, launches, benchmark] = await Promise.all([
      getJson('/v1/lifecycle?limit=500'),
      getJson('/v1/launches?limit=50'),
      getJson('/v1/benchmark').catch(() => null),
    ]);
    statusDot.className = 'status-dot ok';
    renderMetabolism(lifecycle);
    renderPnl(lifecycle);
    renderLifecycle(lifecycle);
    renderLaunches(launches.launches);
    if (benchmark && benchmark.all) {
      renderBenchmark(benchmark);
    } else {
      document.getElementById('benchmark-wrap').innerHTML =
        '<p class="empty">benchmark not yet computed — the worker writes a snapshot every 5 minutes</p>';
    }
  } catch (err) {
    statusDot.className = 'status-dot bad';
    // eslint-disable-next-line no-console
    console.error('[dashboard] load failed', err);
  }
}

function initApiConfig() {
  const input = document.getElementById('api-base');
  input.value = getApiBase();
  document.getElementById('api-reload').addEventListener('click', () => {
    setApiBase(input.value.trim() || defaultApiBase());
    loadAll();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') document.getElementById('api-reload').click();
  });
}

initApiConfig();
loadAll();
setInterval(loadAll, 30_000);
