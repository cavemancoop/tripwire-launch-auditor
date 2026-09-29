import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
assert.match(source, /\nboot\(\);\s*$/);

function render(snapshot) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '' });
      return elements.get(id);
    },
  };
  const context = createContext({ document, snapshot });
  runInContext(source.replace(/\nboot\(\);\s*$/, ''), context);
  runInContext('renderBenchmark(snapshot)', context);
  return (id) => elements.get(id)?.innerHTML ?? '';
}

const cell = (n) => ({
  forecaster: 'det_v0', n, positives: Math.floor(n / 3), auroc: 0.6,
  brierSkill: 0.1, invertedRanking: true, insufficientSample: false,
  comparisons: [{ vs: 'base_rate', claimAllowed: true, p: 0.01 }],
});
const section = (splitBy, splitValue, n) => ({
  splitBy, splitValue, byOutcome: { 'TRADING_ALIVE@24h': [cell(n)] },
});

test('renders only lane sections in the lane table while preserving the pooled view', () => {
  const snapshot = {
    live: {
      minForMetrics: 100, minForClaims: 200,
      sections: [
        section('all', 'all', 300), section('trigger', 'launch', 300),
        section('source', 'raw', 300), section('lane', 'index', 180),
        section('lane', 'qualified', 120),
      ],
    },
    coverage: { 'TRADING_ALIVE@24h': { resolved: 300, pendingDue: 900 } },
    resolutionPolicy: 'Current policy',
  };
  const html = render(snapshot);
  assert.match(html('benchmark-wrap'), /Graded so far: 300 of 1,200/);
  assert.match(html('benchmark-wrap'), /Current policy/);
  assert.match(html('benchmark-wrap'), /beats base_rate/);
  assert.match(html('benchmark-wrap'), /ranks backwards/);
  assert.equal((html('benchmark-lanes-wrap').match(/<tr>/g) ?? []).length, 3);
  assert.match(html('benchmark-lanes-wrap'), /<td>index<\/td>/);
  assert.match(html('benchmark-lanes-wrap'), /<td>qualified<\/td>/);
  assert.doesNotMatch(html('benchmark-lanes-wrap'), /<td>launch<\/td>|<td>raw<\/td>/);
  assert.doesNotMatch(html('benchmark-lanes-wrap'), /beats base_rate/);
  assert.doesNotMatch(html('benchmark-lanes-wrap'), /ranks backwards/);
});

test('explains missing lane sections without hiding the pooled benchmark', () => {
  const snapshot = {
    live: { minForMetrics: 100, minForClaims: 200, sections: [section('all', 'all', 300)] },
  };
  const html = render(snapshot);
  assert.match(html('benchmark-wrap'), /<table>/);
  assert.match(html('benchmark-lanes-wrap'), /fresh scorer snapshot/);
});
