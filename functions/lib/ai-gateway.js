const MAX_TEXT = 12000;

export const AI_PROVIDERS = ['OPENAI', 'ANTHROPIC'];
export const AI_PURPOSES = [
  'INVESTOR_RESEARCH',
  'FIT_EXPLANATION',
  'INTRODUCTION_DRAFT',
  'MEETING_BRIEF',
  'FOLLOW_UP_DRAFT',
  'DILIGENCE_RESPONSE',
];
export const DISCLOSURE_POLICIES = ['INTERNAL', 'SAFE_FOR_OUTREACH', 'MEETING_ONLY', 'DILIGENCE_ONLY'];

const DEFAULT_PURPOSES = [...AI_PURPOSES];
const OUTREACH_PURPOSES = new Set(['INTRODUCTION_DRAFT', 'FOLLOW_UP_DRAFT']);
const MEETING_PURPOSES = new Set(['MEETING_BRIEF']);
const DILIGENCE_PURPOSES = new Set(['DILIGENCE_RESPONSE']);

export function cleanAiText(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

export function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeProvider(value, fallback = 'OPENAI') {
  const provider = cleanAiText(value, 40).toUpperCase();
  return AI_PROVIDERS.includes(provider) ? provider : fallback;
}

function normalizeModel(value) {
  const model = cleanAiText(value, 160);
  if (!model) return '';
  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) {
    const error = new Error('Model identifiers may contain only letters, numbers, dots, underscores, slashes, colons and hyphens');
    error.status = 422;
    throw error;
  }
  return model;
}

function normalizePurposes(value) {
  const requested = Array.isArray(value) ? value : DEFAULT_PURPOSES;
  const purposes = requested
    .map((item) => cleanAiText(item, 80).toUpperCase())
    .filter((item) => AI_PURPOSES.includes(item));
  return [...new Set(purposes.length ? purposes : DEFAULT_PURPOSES)];
}

export function normalizeAiConfig(value = {}) {
  const raw = safeJson(value, {});
  const primaryProvider = normalizeProvider(raw.primaryProvider, 'OPENAI');
  let fallbackProvider = normalizeProvider(raw.fallbackProvider, primaryProvider === 'OPENAI' ? 'ANTHROPIC' : 'OPENAI');
  if (fallbackProvider === primaryProvider) fallbackProvider = primaryProvider === 'OPENAI' ? 'ANTHROPIC' : 'OPENAI';
  return {
    version: 1,
    enabled: Boolean(raw.enabled),
    primaryProvider,
    fallbackProvider,
    allowFallback: Boolean(raw.allowFallback),
    models: {
      OPENAI: normalizeModel(raw.models?.OPENAI || raw.openaiModel || ''),
      ANTHROPIC: normalizeModel(raw.models?.ANTHROPIC || raw.anthropicModel || ''),
    },
    enabledPurposes: normalizePurposes(raw.enabledPurposes),
    maxOutputTokens: Math.min(4000, Math.max(256, Number(raw.maxOutputTokens) || 1200)),
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

export function providerAvailability(env = {}, configValue = {}) {
  const config = normalizeAiConfig(configValue);
  const openAiModel = config.models.OPENAI || cleanAiText(env.OPENAI_MODEL, 160);
  const anthropicModel = config.models.ANTHROPIC || cleanAiText(env.ANTHROPIC_MODEL, 160);
  return {
    OPENAI: {
      provider: 'OPENAI',
      label: 'OpenAI · ChatGPT models',
      secretConfigured: Boolean(env.OPENAI_API_KEY),
      model: openAiModel,
      configured: Boolean(env.OPENAI_API_KEY && openAiModel),
    },
    ANTHROPIC: {
      provider: 'ANTHROPIC',
      label: 'Anthropic · Claude models',
      secretConfigured: Boolean(env.ANTHROPIC_API_KEY),
      model: anthropicModel,
      configured: Boolean(env.ANTHROPIC_API_KEY && anthropicModel),
    },
  };
}

export function validateProposalRequest(input = {}, configValue = {}) {
  const config = normalizeAiConfig(configValue);
  if (!config.enabled) {
    const error = new Error('AI proposals are disabled for this workspace');
    error.status = 409;
    throw error;
  }
  const purpose = cleanAiText(input.purpose, 80).toUpperCase();
  if (!AI_PURPOSES.includes(purpose) || !config.enabledPurposes.includes(purpose)) {
    const error = new Error('This AI proposal purpose is not enabled for the workspace');
    error.status = 422;
    throw error;
  }
  const sharePolicy = cleanAiText(input.sharePolicy || 'INTERNAL', 80).toUpperCase();
  if (!DISCLOSURE_POLICIES.includes(sharePolicy)) {
    const error = new Error('Disclosure policy is invalid');
    error.status = 422;
    throw error;
  }
  if (OUTREACH_PURPOSES.has(purpose) && sharePolicy !== 'SAFE_FOR_OUTREACH') {
    const error = new Error('Outreach drafts may use only SAFE_FOR_OUTREACH context');
    error.status = 409;
    throw error;
  }
  if (MEETING_PURPOSES.has(purpose) && !['SAFE_FOR_OUTREACH', 'MEETING_ONLY'].includes(sharePolicy)) {
    const error = new Error('Meeting briefs may use only SAFE_FOR_OUTREACH or MEETING_ONLY context');
    error.status = 409;
    throw error;
  }
  if (DILIGENCE_PURPOSES.has(purpose) && !['SAFE_FOR_OUTREACH', 'DILIGENCE_ONLY'].includes(sharePolicy)) {
    const error = new Error('Diligence drafts may use only SAFE_FOR_OUTREACH or DILIGENCE_ONLY context');
    error.status = 409;
    throw error;
  }
  const instructions = cleanAiText(input.instructions, 6000);
  const context = cleanAiText(input.context, 12000);
  if (!instructions) {
    const error = new Error('AI proposal instructions are required');
    error.status = 422;
    throw error;
  }
  if (!context) {
    const error = new Error('Governed context is required');
    error.status = 422;
    throw error;
  }
  return { purpose, sharePolicy, instructions, context, config };
}

function purposeGuidance(purpose) {
  const guidance = {
    INVESTOR_RESEARCH: 'Produce a structured investor research proposal with evidence gaps, verification tasks and unknowns. Do not invent facts.',
    FIT_EXPLANATION: 'Explain the investor fit score using only the supplied evidence. Separate positive signals, risks, missing evidence and conflicts.',
    INTRODUCTION_DRAFT: 'Draft a concise warm-introduction request. Use only outreach-safe facts and do not claim an introduction or relationship is verified unless the context explicitly says so.',
    MEETING_BRIEF: 'Prepare a meeting brief with objectives, evidence-backed talking points, questions, risks and follow-up actions.',
    FOLLOW_UP_DRAFT: 'Draft a concise investor follow-up using only outreach-safe facts. Do not imply commitments or approvals that are not present.',
    DILIGENCE_RESPONSE: 'Draft a diligence response using only the supplied diligence-approved context. Mark missing evidence and items requiring human verification.',
  };
  return guidance[purpose] || 'Prepare a factual proposal from the supplied context.';
}

function systemInstructions(request) {
  return [
    'You are the controlled AI proposal layer inside AKARI CRM.',
    'You may propose content but you may not send messages, grant access, change CRM records, confirm commitments or close fundraising rounds.',
    'Use only the supplied context. Never invent investor facts, relationships, commitments, metrics or legal claims.',
    'Clearly separate verified evidence, inference and unknown information.',
    `Disclosure policy: ${request.sharePolicy}.`,
    purposeGuidance(request.purpose),
  ].join('\n');
}

function userPrompt(request) {
  return `TASK\n${request.instructions}\n\nGOVERNED CONTEXT\n${request.context}`;
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = [];
  for (const output of Array.isArray(payload?.output) ? payload.output : []) {
    for (const item of Array.isArray(output?.content) ? output.content : []) {
      if (typeof item?.text === 'string') chunks.push(item.text);
      else if (typeof item?.output_text === 'string') chunks.push(item.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function extractAnthropicText(payload) {
  return (Array.isArray(payload?.content) ? payload.content : [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

async function timedFetch(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function providerError(message, status = 502, providerStatus = null) {
  const error = new Error(message);
  error.status = status;
  error.providerStatus = providerStatus;
  return error;
}

export async function invokeAiProvider({ provider, env, config: configValue, request, fetchImpl = fetch }) {
  const config = normalizeAiConfig(configValue);
  const availability = providerAvailability(env, config);
  const normalizedProvider = normalizeProvider(provider, config.primaryProvider);
  const state = availability[normalizedProvider];
  if (!state?.secretConfigured) throw providerError(`${state?.label || normalizedProvider} API key is not configured as a Cloudflare secret`, 503);
  if (!state?.model) throw providerError(`${state?.label || normalizedProvider} model is not configured`, 503);
  const timeoutMs = Math.min(60000, Math.max(5000, Number(env.AI_TIMEOUT_MS) || 30000));
  const system = systemInstructions(request);
  const prompt = userPrompt(request);

  if (normalizedProvider === 'OPENAI') {
    const response = await timedFetch(fetchImpl, 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: state.model,
        instructions: system,
        input: prompt,
        max_output_tokens: config.maxOutputTokens,
      }),
    }, timeoutMs);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError('OpenAI could not generate the proposal', response.status >= 500 || response.status === 429 ? 503 : 422, response.status);
    const text = extractOpenAiText(payload);
    if (!text) throw providerError('OpenAI returned an empty proposal', 502);
    return { provider: normalizedProvider, model: state.model, text, requestId: response.headers.get('x-request-id') || null };
  }

  const response = await timedFetch(fetchImpl, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: state.model,
      max_tokens: config.maxOutputTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, timeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError('Anthropic could not generate the proposal', response.status >= 500 || response.status === 429 ? 503 : 422, response.status);
  const text = extractAnthropicText(payload);
  if (!text) throw providerError('Anthropic returned an empty proposal', 502);
  return { provider: normalizedProvider, model: state.model, text, requestId: response.headers.get('request-id') || null };
}

export function shouldFallback(error) {
  return Number(error?.status || 500) >= 500;
}
