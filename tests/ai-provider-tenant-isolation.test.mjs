import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getProviders, onRequestPost as saveProviders } from '../functions/api/ai/providers.js';
import { onRequestPost as propose } from '../functions/api/ai/propose.js';
import { invokeAiProvider, normalizeAiConfig, validateProposalRequest } from '../functions/lib/ai-gateway.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql:String(sql), bindings };
        this.calls.push(call);
        return {
          first: async () => this.resolver('first', call, this.calls.length - 1),
          all: async () => ({ results:await this.resolver('all', call, this.calls.length - 1) || [] }),
          run: async () => this.resolver('run', call, this.calls.length - 1) || { success:true },
        };
      },
    };
  }
}

function context({ db, role = 'OWNER', body, path = '/api/ai/providers', env = {} }) {
  return {
    env:{ DB:db, ...env },
    data:{ auth:{ userId:'user_a', email:'owner@example.test', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess:true } },
    request:new Request(`https://crm.test${path}`, body === undefined ? {} : {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body),
    }),
  };
}

const savedConfig = {
  aiGatewayV1:{
    version:1,
    enabled:true,
    primaryProvider:'OPENAI',
    fallbackProvider:'ANTHROPIC',
    allowFallback:true,
    models:{ OPENAI:'gpt-test', ANTHROPIC:'claude-test' },
    enabledPurposes:['INVESTOR_RESEARCH','INTRODUCTION_DRAFT'],
    maxOutputTokens:1200,
  },
};

test('AI provider settings are tenant scoped and never expose provider secrets', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(savedConfig) };
    return null;
  });
  const response = await getProviders(context({ db, env:{ OPENAI_API_KEY:'secret-openai', ANTHROPIC_API_KEY:'secret-anthropic' } }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.primaryProvider, 'OPENAI');
  assert.equal(payload.providers.find((item) => item.provider === 'OPENAI').configured, true);
  assert.equal(payload.providers.find((item) => item.provider === 'ANTHROPIC').configured, true);
  assert.equal(JSON.stringify(payload).includes('secret-openai'), false);
  assert.equal(JSON.stringify(payload).includes('secret-anthropic'), false);
  const lookup = db.calls.find((call) => /tenant_settings/.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a']);
});

test('only Owner and Admin can change AI provider settings', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await saveProviders(context({ db, role:'BD_MANAGER', body:{ enabled:true } }));
  assert.equal(response.status, 403);
  assert.equal(db.calls.length, 0);
});

test('AI provider settings reject API keys submitted through the CRM', async () => {
  const db = new FakeDB(() => null);
  const response = await saveProviders(context({ db, body:{ enabled:true, openaiApiKey:'do-not-store' } }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /Cloudflare secrets/i);
  assert.equal(db.calls.some((call) => /INSERT|UPDATE/.test(call.sql)), false);
});

test('AI provider configuration writes and audits only the authenticated tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:'{}' };
    return null;
  });
  const response = await saveProviders(context({
    db,
    env:{ OPENAI_API_KEY:'configured' },
    body:{
      enabled:true,
      primaryProvider:'OPENAI',
      fallbackProvider:'ANTHROPIC',
      allowFallback:false,
      models:{ OPENAI:'gpt-test', ANTHROPIC:'claude-test' },
      enabledPurposes:['INVESTOR_RESEARCH','MEETING_BRIEF'],
      maxOutputTokens:1500,
    },
  }));
  assert.equal(response.status, 200);
  const update = db.calls.find((call) => /UPDATE tenant_settings/.test(call.sql));
  assert.ok(update);
  assert.equal(update.bindings.at(-1), 'tenant_a');
  const audit = db.calls.find((call) => /AI_PROVIDER_SETTINGS_UPDATED/.test(call.sql));
  assert.ok(audit);
  assert.equal(audit.bindings[1], 'tenant_a');
});

test('AI proposal endpoint rejects read-only roles before database or provider access', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await propose(context({
    db,
    role:'VIEWER',
    path:'/api/ai/propose',
    body:{ purpose:'INVESTOR_RESEARCH', sharePolicy:'INTERNAL', instructions:'Research', context:'Evidence' },
  }));
  assert.equal(response.status, 403);
  assert.equal(db.calls.length, 0);
});

test('outreach proposal validation blocks non-outreach-safe context', () => {
  const config = normalizeAiConfig({ ...savedConfig.aiGatewayV1, enabledPurposes:['INTRODUCTION_DRAFT'] });
  assert.throws(() => validateProposalRequest({
    purpose:'INTRODUCTION_DRAFT', sharePolicy:'INTERNAL', instructions:'Draft intro', context:'Private notes',
  }, config), /SAFE_FOR_OUTREACH/);
});

test('OpenAI adapter uses the Responses API without exposing credentials in output', async () => {
  const calls = [];
  const result = await invokeAiProvider({
    provider:'OPENAI',
    env:{ OPENAI_API_KEY:'openai-secret', OPENAI_MODEL:'gpt-test' },
    config:{ enabled:true, primaryProvider:'OPENAI', models:{ OPENAI:'gpt-test' }, maxOutputTokens:800 },
    request:{ purpose:'INVESTOR_RESEARCH', sharePolicy:'INTERNAL', instructions:'Explain fit', context:'Verified Seed investor evidence' },
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ output_text:'Evidence-backed proposal' }), { status:200, headers:{ 'x-request-id':'req_openai' } });
    },
  });
  assert.equal(result.text, 'Evidence-backed proposal');
  assert.equal(result.requestId, 'req_openai');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].options.headers.authorization, 'Bearer openai-secret');
  assert.equal(JSON.stringify(result).includes('openai-secret'), false);
});

test('Anthropic adapter uses the Messages API and required version header', async () => {
  const calls = [];
  const result = await invokeAiProvider({
    provider:'ANTHROPIC',
    env:{ ANTHROPIC_API_KEY:'anthropic-secret', ANTHROPIC_MODEL:'claude-test' },
    config:{ enabled:true, primaryProvider:'ANTHROPIC', models:{ ANTHROPIC:'claude-test' }, maxOutputTokens:800 },
    request:{ purpose:'MEETING_BRIEF', sharePolicy:'MEETING_ONLY', instructions:'Prepare brief', context:'Approved meeting context' },
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ content:[{ type:'text', text:'Meeting brief proposal' }] }), { status:200, headers:{ 'request-id':'req_anthropic' } });
    },
  });
  assert.equal(result.text, 'Meeting brief proposal');
  assert.equal(result.requestId, 'req_anthropic');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'anthropic-secret');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
});
