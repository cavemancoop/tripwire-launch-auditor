// M8 dashboard — no build step, no framework. Every number here either comes
// straight off an api response or is a transparently-labelled derivation from
// one (credits/hr, spend/report, rotation counts); nothing is invented when
// data is missing — those cases render "n/a" or an explicit note instead.

const EXPLORER_BASE = 'https://robinhoodchain.blockscout.com';
const LS_KEY = 'launch-auditor:api-base';

/**
 * Outcomes we measure and publish but do not treat as forecastable. The sell
 * simulation uses a fixed $100 notional against pools whose median depth at
 * T+10m is ~$1,040, so it is ~10% of the pool: the price moves hard on an
 * entirely honest token, and ~90% of launches come back "impaired". The number
 * is a real measurement of liquidity depth, not evidence of deception, and no
 * notional fixes that — 2% of a thin pool still moves the price. So it renders
 * without a claim badge, whatever the arithmetic gate says.
 */
const DESCRIPTIVE_OUTCOMES = {
  'SELL_IMPAIRED@1h':
    'Fixed $100 sell against pools of ~$1k median depth — measures liquidity depth, not deception. Not treated as a forecastable claim.',
  'SELL_IMPAIRED@24h':
    'Fixed $100 sell against pools of ~$1k median depth — measures liquidity depth, not deception. Not treated as a forecastable claim.',
};

// Filled from /config.json at boot (the web service's API_BASE_URL). Guessing
// `own-hostname:3000` only ever worked when one machine ran everything; on a
// per-service-hostname host it's always wrong, and it made every visitor paste
// the URL by hand before the dashboard showed anything. A saved override still
// wins, so pointing a browser at a different instance stays a one-field change.
let servedApiBase = '';

function defaultApiBase() {
  return servedApiBase || `${location.protocol}//${location.hostname}:3000`;
}

function getApiBase() {
  try {
    return localStorage.getItem(LS_KEY) || defaultApiBase();
  } catch {
    return defaultApiBase();
  }
}

async function loadServedConfig() {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg && typeof cfg.apiBase === 'string' && cfg.apiBase) {
      servedApiBase = cfg.apiBase.replace(/\/$/, '');
    }
  } catch {
    /* no served config — fall back to the guess, same as before */
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

/** How long ago the last balance reading landed — printed rather than hidden. */
function balanceAgeLabel(lifecycle) {
  const entries = lifecycle?.entries ?? [];
  const last = entries[entries.length - 1];
  if (!last?.at) return 'never';
  const mins = (Date.now() - Date.parse(last.at)) / 60000;
  if (!Number.isFinite(mins) || mins < 0) return 'unknown';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h ago`;
  return `${(mins / 1440).toFixed(1)}d ago`;
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

  grid.appendChild(metric('AI balance', usd(latest?.balanceUsd ?? null), latest?.keyHashPrefix ? `${latest.newState} · key ${latest.keyHashPrefix}` : latest ? latest.newState : 'no reading yet'));
  grid.appendChild(metric('Credits accrued', accrual ? `${usd(accrual.perHour)}/hr` : 'n/a', accrual ? `over ${accrual.hours.toFixed(1)}h of samples` : 'not enough samples yet'));
  grid.appendChild(metric('Spend per report', spendPerReport !== null ? usd(spendPerReport, 4) : 'n/a', `${estimator.requests24h} requests, trailing 24h`));
  grid.appendChild(metric('Rotations', String(rotations), `${revocations} revocation${revocations === 1 ? '' : 's'}`));
  grid.appendChild(metric('Billing status', latest?.billingStatus ?? 'n/a', latest?.newState ?? 'no reading yet'));

  const b = budget;
  document.getElementById('budget-body').innerHTML = `
    <div class="kv"><span class="k">daily cap</span><span class="v">${usd(b.dailyCapUsd)}</span></div>
    <div class="kv"><span class="k">spent, trailing 24h</span><span class="v">${usd(b.spentTrailing24hUsd)}</span></div>
    <div class="kv"><span class="k">remaining today</span><span class="v">${usd(b.remainingTodayUsd)}</span></div>
    <div class="kv"><span class="k">spendable on key</span><span class="v">${usd(b.spendableKeyUsd)}</span></div>
    <div class="kv"><span class="k">next run allows up to</span><span class="v">${usd(b.maxRunCostUsd)}</span></div>
    <div class="kv"><span class="k">binding constraint</span><span class="v">${b.bindingConstraint}</span></div>
    ${b.gateClosedByBilling ? '<p class="note" style="color:var(--bad)">Gate closed — billing status is anomaly or phantom.</p>' : ''}
    ${b.balanceStale ? `<p class="note" style="color:var(--warn)">Balance last confirmed ${balanceAgeLabel(lifecycle)} — the Orbio MCP session bounds key management, not spending, so research continues under the daily cap and the local ledger.</p>` : ''}
  `;

  const check = { verified: lifecycle.verified, startsAtGenesis: lifecycle.startsAtGenesis, brokenAt: lifecycle.brokenAt };
  const spanMs = entries.length ? new Date(entries[entries.length - 1].at).getTime() - new Date(entries[0].at).getTime() : 0;
  const spanDays = spanMs / 86_400_000;
  document.getElementById('continuity-body').innerHTML = `
    ${entries.length === 0
      ? '<div class="kv"><span class="k">chain</span><span class="v">no signed rows yet — nothing to verify</span></div>'
      : `<div class="kv"><span class="k">chain verified</span><span class="v">${check.verified ? 'yes' : 'BROKEN at ' + check.brokenAt}</span></div>
    <div class="kv"><span class="k">starts at genesis</span><span class="v">${check.startsAtGenesis ? 'yes' : 'no'}</span></div>`}
    <div class="kv"><span class="k">log span held</span><span class="v">${spanDays.toFixed(2)} days (${entries.length} rows)</span></div>
    <p class="note">The agent's API key is a signature from its own wallet, so no sign-in expires. This describes what the signed log currently covers, not a guarantee of what comes next.</p>
  `;
}

// ── P&L ──────────────────────────────────────────────────────────────────

function renderPnl(lifecycle) {
  const { estimator } = lifecycle;
  const n = estimator.requests24h;
  const reqs = `${n} request${n === 1 ? '' : 's'}`;

  const standalone = document.querySelector('#pnl-standalone .pnl-body');
  standalone.innerHTML = `
    <div class="big">${usd(estimator.estimatedSpend24hUsd, 4)}</div>
    <div class="kv"><span class="k">basis</span><span class="v">token counts × pinned model price</span></div>
    <div class="kv"><span class="k">requests</span><span class="v">${n}</span></div>
    <p class="note">What the trailing-24h LLM deep-dives would cost at list price on a plain OpenRouter account. An estimate, labelled as one.</p>
  `;

  const orbio = document.querySelector('#pnl-orbio .pnl-body');
  orbio.innerHTML = `
    <div class="big">${usd(estimator.providerSpend24hUsd, 4)}</div>
    <div class="kv"><span class="k">basis</span><span class="v">${estimator.basis === 'epoch_reconciled' ? "Orbio's own balance counter, per 60s window" : estimator.basis}</span></div>
    <div class="kv"><span class="k">paid from</span><span class="v">activated CREDIT balance</span></div>
    <p class="note">Same ${reqs}, as charged by the Orbio gateway to the agent's account. Where that balance came from is listed under Funding, with the on-chain transactions.</p>
  `;
}

// ── Funding ─────────────────────────────────────────────────────────────

function renderFunding(f) {
  const body = document.getElementById('funding-body');
  if (!f || !f.configured) {
    body.innerHTML = '<p class="note">Funding source not configured on this instance.</p>';
    return;
  }
  const rows = f.activations
    .map(
      (a) => `<div class="kv"><span class="k">${fmtDate(a.at)} · #${a.activationId} · ${a.by === 'agent' ? 'agent activated its own CREDIT' : 'operator activation from ' + short(a.from)}</span><span class="v">${usd(a.amountUsd)} · <a href="${EXPLORER_BASE}/tx/${a.txHash}" target="_blank" rel="noopener">tx ↗</a></span></div>`,
    )
    .join('');
  body.innerHTML = `
    <div class="kv"><span class="k">agent account</span><span class="v"><a href="${EXPLORER_BASE}/address/${f.account}" target="_blank" rel="noopener">${short(f.account)} ↗</a></span></div>
    <div class="kv"><span class="k">activated in total</span><span class="v">${usd(f.totalActivatedUsd)} (operator ${usd(f.byOperatorUsd)} · agent ${usd(f.byAgentUsd)})</span></div>
    ${rows || '<p class="note">No activations yet.</p>'}
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
      const descriptive = DESCRIPTIVE_OUTCOMES[outcome];
      rows.push(`<tr>
        <td>${outcome}${descriptive ? ' <span class="badge dim" title="' + descriptive + '">descriptive</span>' : ''}</td>
        <td>${c.forecaster}</td>
        <td>${c.n}${retro > 0 ? ` <span class="badge dim">+${retro} retro</span>` : ''}${c.insufficientSample ? ' <span class="badge warn">insufficient</span>' : ''}</td>
        <td>${c.positives}</td>
        <td>${c.auroc === null ? 'n/a' : c.auroc.toFixed(3)}</td>
        <td>${c.brierSkill === null ? 'n/a' : c.brierSkill.toFixed(3)}</td>
        <td>${descriptive ? '' : claim ? `<span class="badge good">beats ${claim.vs} p=${claim.p}</span>` : ''}</td>
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
    const [lifecycle, launches, benchmark, funding] = await Promise.all([
      getJson('/v1/lifecycle?limit=500'),
      getJson('/v1/launches?limit=50'),
      getJson('/v1/benchmark').catch(() => null),
      getJson('/v1/funding').catch(() => null),
    ]);
    statusDot.className = 'status-dot ok';
    renderMetabolism(lifecycle);
    renderPnl(lifecycle);
    renderFunding(funding);
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

async function boot() {
  await loadServedConfig(); // before initApiConfig, so the box shows the real default
  initApiConfig();
  await loadAll();
  setInterval(loadAll, 30_000);
}

boot();
