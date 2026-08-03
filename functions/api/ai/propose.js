import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';
import {
  invokeAiProvider,
  normalizeAiConfig,
  providerAvailability,
  safeJson,
  shouldFallback,
  validateProposalRequest,
} from '../../lib/ai-gateway.js';

const PROPOSAL_ROLES = ['OWNER', 'ADMIN', 'BD_MANAGER'];

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadConfig(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const flags = safeJson(row?.feature_flags_json, {});
  return normalizeAiConfig(flags.aiGatewayV1 || {});
}

async function audit(db, auth, action, metadata) {
  await run(db, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'AI_PROPOSAL', ?, NULL, ?, ?)
  `, [
    makeId('aud'),
    auth.tenantId,
    auth.userId,
    action,
    metadata.requestId,
    JSON.stringify(metadata),
    nowIso(),
  ]);
}

export async function onRequestPost(context) {
  let auditBase = null;
  try {
    const auth = context.data.auth;
    requireRole(auth, PROPOSAL_ROLES);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const config = await loadConfig(context.env.DB, tenantId);
    const request = validateProposalRequest(body, config);
    const requestId = makeId('ai_req');
    const inputHash = await sha256(`${request.purpose}\n${request.sharePolicy}\n${request.instructions}\n${request.context}`);
    auditBase = {
      requestId,
      purpose: request.purpose,
      sharePolicy: request.sharePolicy,
      inputHash,
      primaryProvider: config.primaryProvider,
      fallbackProvider: config.fallbackProvider,
      allowFallback: config.allowFallback,
    };

    const availability = providerAvailability(context.env, config);
    const primaryState = availability[config.primaryProvider];
    if (!primaryState?.configured) {
      throw Object.assign(new Error(`${primaryState?.label || config.primaryProvider} is not fully configured`), { status: 503 });
    }

    let result;
    let fallbackUsed = false;
    try {
      result = await invokeAiProvider({
        provider: config.primaryProvider,
        env: context.env,
        config,
        request,
      });
    } catch (cause) {
      const fallbackState = availability[config.fallbackProvider];
      if (!config.allowFallback || !fallbackState?.configured || !shouldFallback(cause)) throw cause;
      fallbackUsed = true;
      result = await invokeAiProvider({
        provider: config.fallbackProvider,
        env: context.env,
        config,
        request,
      });
    }

    const outputHash = await sha256(result.text);
    await audit(context.env.DB, auth, 'AI_PROPOSAL_GENERATED', {
      ...auditBase,
      provider: result.provider,
      model: result.model,
      fallbackUsed,
      providerRequestId: result.requestId,
      outputHash,
      outputLength: result.text.length,
    });

    return json({
      requestId,
      purpose: request.purpose,
      sharePolicy: request.sharePolicy,
      provider: result.provider,
      model: result.model,
      fallbackUsed,
      proposal: result.text,
      approvalRequired: true,
      prohibitedActions: ['SEND_MESSAGE', 'GRANT_DATA_ROOM_ACCESS', 'CONFIRM_COMMITMENT', 'CLOSE_ROUND'],
    });
  } catch (cause) {
    console.error('AKARI AI proposal failed', cause);
    try {
      if (auditBase && context.env.DB && context.data?.auth?.tenantId) {
        await audit(context.env.DB, context.data.auth, 'AI_PROPOSAL_FAILED', {
          ...auditBase,
          errorClass: Number(cause?.status || 500) >= 500 ? 'PROVIDER_OR_CONFIGURATION' : 'VALIDATION',
          status: Number(cause?.status || 500),
        });
      }
    } catch (auditError) {
      console.error('AKARI AI proposal failure audit failed', auditError);
    }
    return error(cause.message || 'AI proposal could not be generated', Number(cause.status || 500));
  }
}
