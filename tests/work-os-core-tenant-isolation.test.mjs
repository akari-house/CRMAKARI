import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/work-os-core.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql:String(sql), bindings };
        this.calls.push(call);
        return {
          all: async () => ({ results:await this.resolver('all', call) || [] }),
          first: async () => this.resolver('first', call),
          run: async () => this.resolver('run', call) || { success:true },
        };
      },
    };
  }
}

function context(db, scope = 'mine') {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a', tenantId:'tenant_a', tenantSlug:'tenant-a', role:'OWNER', financeAccess:true } },
    request:new Request(`https://crm.example.test/api/work-os-core?scope=${scope}`),
  };
}

const taskRow = {
  id:'task_a', title:'Follow up partner', description:null, owner_user_id:'user_a', owner_name:'Owner A',
  status:'TODO', priority:'HIGH', due_at:'2030-08-05T14:00:00.000Z', completed_at:null,
  project_id:'project_a', project_name:'Project A', contact_id:null, contact_name:null,
  opportunity_id:null, opportunity_name:null, campaign_id:null, campaign_name:null,
  activity_type:'WORKSTREAM:BD', recurrence_rule:null, show_on_home:1,
  created_at:'2030-08-01T00:00:00.000Z', updated_at:'2030-08-01T00:00:00.000Z',
};

function resolver(method, call) {
  if (method !== 'all') return null;
  if (/FROM tasks t/.test(call.sql)) return [taskRow];
  if (/FROM tenant_memberships/.test(call.sql)) return [{ id:'user_a', full_name:'Owner A', email:'owner@example.com', role:'OWNER' }];
  throw new Error(`Unexpected query: ${call.sql}`);
}

test('fast Work OS mine scope is restricted to the authenticated tenant and user', async () => {
  const db = new FakeDB(resolver);
  const response = await onRequestGet(context(db, 'mine'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.partial, true);
  assert.equal(payload.tasks.length, 1);
  assert.equal(payload.tasks[0].projectId, 'project_a');
  assert.equal(payload.calendarEvents.length, 1);
  assert.equal(payload.performance.mode, 'core');

  const taskLookup = db.calls.find((call) => /FROM tasks t/.test(call.sql));
  const memberLookup = db.calls.find((call) => /FROM tenant_memberships/.test(call.sql));
  assert.deepEqual(taskLookup.bindings, ['tenant_a', 'user_a']);
  assert.match(taskLookup.sql, /t\.tenant_id = \?/);
  assert.match(taskLookup.sql, /t\.owner_user_id = \?/);
  assert.deepEqual(memberLookup.bindings, ['tenant_a']);
  assert.equal(db.calls.length, 2);
});

test('fast Work OS team scope remains tenant scoped without leaking another workspace', async () => {
  const db = new FakeDB(resolver);
  const response = await onRequestGet(context(db, 'team'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.scope, 'team');

  const taskLookup = db.calls.find((call) => /FROM tasks t/.test(call.sql));
  assert.deepEqual(taskLookup.bindings, ['tenant_a']);
  assert.match(taskLookup.sql, /t\.tenant_id = \?/);
  assert.doesNotMatch(taskLookup.sql, /t\.owner_user_id = \?/);
});
