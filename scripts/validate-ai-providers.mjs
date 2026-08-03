import { readFile } from 'node:fs/promises';

const files = {
  gateway: await readFile('functions/lib/ai-gateway.js', 'utf8'),
  providersApi: await readFile('functions/api/ai/providers.js', 'utf8'),
  proposeApi: await readFile('functions/api/ai/propose.js', 'utf8'),
  ui: await readFile('public/assets/ai-providers-r17.js', 'utf8'),
  css: await readFile('public/assets/ai-providers-r17.css', 'utf8'),
  shell: await readFile('public/app/index.html', 'utf8'),
  worker: await readFile('public/sw.js', 'utf8'),
  paper: await readFile('docs/BACKEND_TECHNICAL_PAPER.md', 'utf8'),
  tenantTest: await readFile('tests/ai-provider-tenant-isolation.test.mjs', 'utf8'),
  browserTest: await readFile('tests/ai-providers.spec.js', 'utf8'),
};

for (const requirement of [
  "AI_PROVIDERS = ['OPENAI', 'ANTHROPIC']",
  'OpenAI · ChatGPT models',
  'Anthropic · Claude models',
  'https://api.openai.com/v1/responses',
  'https://api.anthropic.com/v1/messages',
  "'anthropic-version': '2023-06-01'",
  'SAFE_FOR_OUTREACH',
  'approval',
  'shouldFallback',
]) {
  if (!files.gateway.includes(requirement)) throw new Error(`AI gateway is incomplete: missing ${requirement}`);
}

for (const requirement of [
  'AI_PROVIDER_SETTINGS_UPDATED',
  'Cloudflare secrets',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'WHERE tenant_id = ?',
  "const MANAGE_ROLES = ['OWNER', 'ADMIN']",
]) {
  if (!files.providersApi.includes(requirement)) throw new Error(`AI provider settings API is incomplete: missing ${requirement}`);
}

for (const requirement of [
  'AI_PROPOSAL_GENERATED',
  'AI_PROPOSAL_FAILED',
  'approvalRequired: true',
  'SEND_MESSAGE',
  'GRANT_DATA_ROOM_ACCESS',
  'CONFIRM_COMMITMENT',
  'CLOSE_ROUND',
  'inputHash',
  'outputHash',
]) {
  if (!files.proposeApi.includes(requirement)) throw new Error(`AI proposal API is incomplete: missing ${requirement}`);
}

for (const requirement of [
  '/api/ai/providers',
  'data-ai17-provider',
  'data-ai17-fallback',
  'Save AI configuration',
  'provider.label',
]) {
  if (!files.ui.includes(requirement)) throw new Error(`AI provider UI is incomplete: missing ${requirement}`);
}

for (const requirement of ['#ai-providers-root', '.ai17-provider', '.ai17-purposes', '@media(max-width:720px)']) {
  if (!files.css.includes(requirement)) throw new Error(`AI provider styling is incomplete: missing ${requirement}`);
}

for (const requirement of ['/assets/ai-providers-r17.css?v=1', '/assets/ai-providers-r17.js?v=1']) {
  if (!files.shell.includes(requirement)) throw new Error(`Protected shell is missing ${requirement}`);
  if (!files.worker.includes(requirement.replace('/assets/', './assets/'))) throw new Error(`Service worker is missing ${requirement}`);
}

for (const requirement of [
  'Provider-neutral AI gateway',
  'OpenAI',
  'Anthropic',
  'Cloudflare secrets',
  '/api/ai/providers',
  '/api/ai/propose',
  'proposal-only',
]) {
  if (!files.paper.includes(requirement)) throw new Error(`Backend technical paper is incomplete: missing ${requirement}`);
}

for (const requirement of [
  'tenant scoped',
  'never expose provider secrets',
  'reject API keys',
  'OpenAI adapter',
  'Anthropic adapter',
]) {
  if (!files.tenantTest.includes(requirement)) throw new Error(`AI tenant/provider tests are incomplete: missing ${requirement}`);
}

for (const requirement of [
  'OpenAI ChatGPT models',
  'Anthropic Claude models',
  'input[type="password"]',
  'mobile page overflow',
]) {
  if (!files.browserTest.includes(requirement)) throw new Error(`AI browser coverage is incomplete: missing ${requirement}`);
}

console.log('AKARI dual OpenAI and Anthropic provider gateway validation passed.');
