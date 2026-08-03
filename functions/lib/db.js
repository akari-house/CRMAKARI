export async function first(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

export async function all(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

function redactInvestorContactAudit(sql, bindings) {
  if (!/INSERT\s+INTO\s+audit_logs/i.test(String(sql)) || !bindings.includes('INVESTOR_CONTACT')) return bindings;
  return bindings.map((binding) => {
    if (typeof binding !== 'string' || !binding.trim().startsWith('{')) return binding;
    try {
      const value = JSON.parse(binding);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return binding;
      if (Object.prototype.hasOwnProperty.call(value, 'value')) value.value = '[REDACTED]';
      if (Object.prototype.hasOwnProperty.call(value, 'normalized_value')) value.normalized_value = '[REDACTED]';
      return JSON.stringify(value);
    } catch {
      return binding;
    }
  });
}

export async function run(db, sql, bindings = []) {
  return db.prepare(sql).bind(...redactInvestorContactAudit(sql, bindings)).run();
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
