import fs from 'node:fs';

const read=(path)=>{
  if(!fs.existsSync(path))throw new Error(`R84 missing ${path}`);
  return fs.readFileSync(path,'utf8');
};
const expect=(condition,message)=>{if(!condition)throw new Error(`R84 validation failed: ${message}`)};

const migration=read('db/migrations/0010_house_boundary_bridge.sql');
const nda=read('functions/api/v1/house-nda-status.js');
const bridge=read('functions/api/v1/house-bridge.js');
const middleware=read('functions/api/v1/_middleware.js');
const rootMiddleware=read('functions/_middleware.js');
const deploy=read('.github/workflows/deploy-cloudflare-pages.yml');
const pkg=JSON.parse(read('package.json'));

expect(migration.includes('CREATE TABLE IF NOT EXISTS external_entity_links'),'stable cross-system entity link table missing');
expect(migration.includes('CREATE TABLE IF NOT EXISTS agreement_counterparty_identity'),'agreement counterparty identity table missing');
expect(migration.includes("external_system IN ('AKARI_HOUSE')"),'bridge must explicitly constrain its source system');
expect(migration.includes("external_entity_type IN ('PROJECT','MEMBER','AGREEMENT')"),'bridge entity types are incomplete');
expect(migration.includes("local_entity_type IN ('PROJECT','CONTACT','AGREEMENT')"),'CRM-side bridge entity types are incomplete');
expect(nda.includes("a.agreement_type='NDA'"),'NDA status endpoint must only read NDA agreements');
expect(nda.includes("a.status IN ('SIGNED','ACTIVE')"),'NDA status endpoint must require signed or active CRM state');
expect(nda.includes("a.end_date IS NULL OR a.end_date > datetime('now')"),'expired NDA must fail closed');
expect(nda.includes("aci.external_member_id=?"),'NDA status must use stable House member identity');
expect(nda.includes("reason:'PROJECT_NOT_LINKED'")&&nda.includes("reason:'NO_ACTIVE_NDA'")&&nda.includes("reason:'SIGNED_NDA'"),'NDA bridge provenance reasons are incomplete');
expect(!nda.includes('signed_document_url'),'NDA status endpoint must not expose signed document URLs');
expect(bridge.includes("operation==='link-entity'")&&bridge.includes("operation==='bind-agreement-counterparty'"),'controlled reconciliation operations missing');
expect(bridge.includes('already linked to a different CRM record'),'entity remapping must fail closed');
expect(bridge.includes('already bound to a different House member'),'agreement counterparty rebinding must fail closed');
expect(middleware.includes("required=method==='GET'||method==='HEAD'?'read':'write'"),'external API read/write scopes must remain enforced');
expect(rootMiddleware.includes("pathname.startsWith('/api/v1/')"),'House bridge must remain behind API-key authentication');
expect(deploy.includes('0010_house_boundary_bridge.sql'),'R84 production migration must be explicitly applied');
expect(deploy.includes("'external_entity_links'")&&deploy.includes("'agreement_counterparty_identity'"),'R84 production schema verification missing');
expect(String(pkg.scripts?.validate||'').includes('validate-house-boundary-bridge-r84.mjs'),'R84 validator must be registered in npm validate');

console.log('R84 House boundary bridge validation passed');
