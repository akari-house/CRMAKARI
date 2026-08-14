import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as getCommandCentreSafe } from '../functions/api/bd-command-center/_middleware.js';

class StrictPatternDB {
  constructor(results = []) {
    this.results = [...results];
    this.calls = [];
  }

  prepare(sql) {
    const statement = String(sql);
    if (/\b(?:LIKE|GLOB)\b/i.test(statement)) {
      throw new Error('D1 pattern operator is not allowed in BD command centre hotfix');
    }
    return {
      bind: (...bindings) => {
        this.calls.push({ sql: statement, bindings });
        return {
          all: async () => ({ results: this.results.shift() || [] }),
          first: async () => null,
          run: async () => ({ success: true }),
        };
      },
    };
  }
}

function context({ db, role = 'OWNER', financeAccess = true, scope = 'team' } = {}) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: {
      auth: {
        userId: 'user_a',
        tenantId: 'tenant_a',
        tenantSlug: 'tenant-a',
        role,
        financeAccess,
      },
    },
    request: new Request(`https://crm.example.test/api/bd-command-center?scope=${scope}`),
    next: async () => new Response('unexpected next', { status: 599 }),
  };
}

test('BD command centre production query avoids SQLite pattern operators', async () => {
  const db = new StrictPatternDB([[], []]);
  const response = await getCommandCentreSafe(context({ db }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.scope, 'TEAM');
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1].sql, /instr\(COALESCE\(pay\.notes, ''\)/i);
  assert.match(db.calls[1].sql, /instr\(UPPER\(COALESCE\(o\.service_type, ''\)\), 'FUNDRAISING'\) = 0/i);
  assert.doesNotMatch(db.calls[1].sql, /\b(?:LIKE|GLOB)\b/i);
});

test('BD member remains owner-scoped through the D1-safe query', async () => {
  const db = new StrictPatternDB([[], []]);
  const response = await getCommandCentreSafe(context({ db, role: 'BD_MEMBER', financeAccess: false, scope: 'team' }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.scope, 'MINE');
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'user_a']);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'user_a']);
  assert.match(db.calls[0].sql, /p\.owner_user_id = \?/);
  assert.match(db.calls[1].sql, /o\.owner_user_id = \?/);
});
