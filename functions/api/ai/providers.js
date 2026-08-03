import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';
import {
  AI_PROVIDERS,
  AI_PURPOSES,
  normalizeAiConfig,
  providerAvailability,
  safeJson,
} from '../../lib/ai-gateway.js';

const MANAGE_ROLES = ['OWNER', 'ADMIN'];
const FORBIDDEN_SECRET_FIELDS = ['apiKey', 'openaiApiKey', 'anthropicApiKey', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

function publicConfig(config, availability, auth) {
  return {
    enabled: config.enabled,
    primaryProvider: config.primaryProvider,
    fallbackProvider: config.fallbackProvider,
    allowFallback: config.allowFallback,
    models: config.models,
    enabledPurposes: config.enabledPurposes,
    maxOutputTokens: config.maxOutputTokens,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
    canManage: MANAGE_ROLES.includes(auth?.role),
    providers: AI_PROVIDERS.map((provider) => availability[provider]),
    purposes: AI_PURPOSES,
    secretRule: 'Provider API keys must be configured as Cloudflare secrets. They are never stored in D1 or entered in the CRM.',
  };
}

async function loadSettings(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const featureFlags = safeJson(row?.feature_flags_json, {});
  return { row, featureFlags, config: normalizeAiConfig(featureFlags.aiGatewayV1 || {}) };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const { config } = await loadSettings(context.env.DB, tenantId);
    return json(publicConfig(config, providerAvailability(context.env, config), auth));
  } catch (cause) {
    console.error('AKARI AI provider settings read failed', cause);
    return error(cause.message || 'AI provider settings could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, MANAGE_ROLES);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const forbidden = FORBIDDEN_SECRET_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (forbidden) return error('API keys must be configured as Cloudflare secrets and cannot be submitted to this endpoint', 422);

    const { row, featureFlags, config: before } = await loadSettings(context.env.DB, tenantId);
    const now = nowIso();
    const next = normalizeAiConfig({
      ...before,
      enabled: body.enabled,
      primaryProvider: body.primaryProvider,
      fallbackProvider: body.fallbackProvider,
      allowFallback: body.allowFallback,
      models: body.models,
      enabledPurposes: body.enabledPurposes,
      maxOutputTokens: body.maxOutputTokens,
      updatedAt: now,
      updatedBy: auth.userId,
    });

    featureFlags.aiGatewayV1 = next;
    if (row) {
      await run(context.env.DB, `
        UPDATE tenant_settings
        SET feature_flags_json = ?, updated_at = ?
        WHERE tenant_id = ?
      `, [JSON.stringify(featureFlags), now, tenantId]);
    } else {
      await run(context.env.DB, `
        INSERT INTO tenant_settings (tenant_id, feature_flags_json, updated_at)
        VALUES (?, ?, ?)
      `, [tenantId, JSON.stringify(featureFlags), now]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'AI_PROVIDER_SETTINGS_UPDATED', 'TENANT', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, tenantId, JSON.stringify(before), JSON.stringify(next), now]);

    return json(publicConfig(next, providerAvailability(context.env, next), auth));
  } catch (cause) {
    console.error('AKARI AI provider settings update failed', cause);
    return error(cause.message || 'AI provider settings could not be updated', Number(cause.status || 500));
  }
}
