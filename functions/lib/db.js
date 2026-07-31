export async function first(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

export async function all(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

export async function run(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).run();
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

