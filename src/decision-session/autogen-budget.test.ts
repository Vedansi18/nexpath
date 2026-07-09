import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from '../store/db.js';
import { setConfig } from '../store/config.js';
import {
  autogenCallBudget,
  autogenCallsThisMonth,
  autogenBudgetAllows,
  recordAutogenCall,
  AUTOGEN_BUDGET_ENV,
  AUTOGEN_BUDGET_CONFIG_KEY,
} from './autogen-budget.js';

const T = Date.UTC(2026, 6, 10); // a fixed instant, so the monthly counter is deterministic

describe('autogen-budget — the cost gate', () => {
  it('is UNCAPPED when no budget is configured (no figure lives in source)', async () => {
    const store = await openStore(':memory:');
    expect(autogenCallBudget(store, {})).toBeUndefined();
    expect(autogenBudgetAllows(store, '/p', T)).toBe(true);
    store.db.close();
  });

  it('reads the budget from the env var, then a config override', async () => {
    const store = await openStore(':memory:');
    expect(autogenCallBudget(store, { [AUTOGEN_BUDGET_ENV]: '5' })).toBe(5);
    setConfig(store, AUTOGEN_BUDGET_CONFIG_KEY, '3');
    expect(autogenCallBudget(store, {})).toBe(3);                        // config override when env unset
    expect(autogenCallBudget(store, { [AUTOGEN_BUDGET_ENV]: '9' })).toBe(9); // env wins
    store.db.close();
  });

  it('caps once the monthly budget is spent', async () => {
    const store = await openStore(':memory:');
    setConfig(store, AUTOGEN_BUDGET_CONFIG_KEY, '2');
    expect(autogenBudgetAllows(store, '/p', T)).toBe(true);
    recordAutogenCall(store, '/p', T);
    expect(autogenBudgetAllows(store, '/p', T)).toBe(true);   // 1 < 2
    recordAutogenCall(store, '/p', T);
    expect(autogenCallsThisMonth(store, '/p', T)).toBe(2);
    expect(autogenBudgetAllows(store, '/p', T)).toBe(false);  // 2 ≥ 2 → blocked
    store.db.close();
  });

  it('counts per month — a new month starts fresh', async () => {
    const store = await openStore(':memory:');
    recordAutogenCall(store, '/p', T);
    expect(autogenCallsThisMonth(store, '/p', T)).toBe(1);
    expect(autogenCallsThisMonth(store, '/p', Date.UTC(2026, 7, 1))).toBe(0); // next month
    store.db.close();
  });

  it('AG-11: the auto-gen source carries no hardcoded monthly budget figure', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter(
      (f) => f.startsWith('auto') && f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0); // non-vacuous
    const FIGURE = /\$\s*\d|\d+(?:\.\d+)?\s*\/\s*(?:user|month|mo)\b|per\s+user\s+per\s+month/i;
    for (const f of files) {
      expect(FIGURE.test(readFileSync(join(dir, f), 'utf-8')), `${f} has no hardcoded budget figure`).toBe(false);
    }
  });
});
