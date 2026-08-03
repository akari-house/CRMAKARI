import { readFile } from 'node:fs/promises';

const files = {
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  ui:await readFile('public/assets/production-readiness-r15.js','utf8'),
  css:await readFile('public/assets/production-readiness-r15.css','utf8'),
  readiness:await readFile('functions/api/production-readiness/index.js','utf8'),
  backup:await readFile('functions/api/tenant-export/index.js','utf8'),
  tenantTest:await readFile('tests/production-readiness-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/production-readiness.spec.js','utf8'),
};

for (const requirement of ['/assets/production-readiness-r15.css?v=1','/assets/production-readiness-r15.js?v=1']) {
  if (!files.shell.includes(requirement)) throw new Error(`Protected shell is missing ${requirement}`);
}
for (const requirement of ['akari-crm-shell-v41','production-readiness-r15.css?v=1','production-readiness-r15.js?v=1','runtime=v41']) {
  if (!files.worker.includes(requirement)) throw new Error(`Service worker is missing ${requirement}`);
}
for (const requirement of ['Production readiness','/api/production-readiness','/api/tenant-export','data-pr15-signoff','Download tenant backup']) {
  if (!files.ui.includes(requirement)) throw new Error(`Production readiness UI is incomplete: missing ${requirement}`);
}
for (const requirement of ['#production-readiness-root','.pr15-score','.pr15-signoff','.pr15-metrics','@media(max-width:760px)']) {
  if (!files.css.includes(requirement)) throw new Error(`Production readiness styling is incomplete: missing ${requirement}`);
}
for (const requirement of ['productionReadinessV1','PRODUCTION_SIGNOFF_UPDATED','p.tenant_id','TENANT_BACKUP_EXPORTED','active_owners','requireTenant']) {
  if (!files.readiness.includes(requirement)) throw new Error(`Production readiness API is incomplete: missing ${requirement}`);
}
for (const requirement of ['AKARI_TENANT_BACKUP_V1','TENANT_BACKUP_EXPORTED','content-disposition','WHERE tenant_id = ?','requireRole']) {
  if (!files.backup.includes(requirement)) throw new Error(`Tenant backup API is incomplete: missing ${requirement}`);
}
for (const requirement of ['authenticated tenant','owner/admin controlled','tenant-scoped data','rejects non-admin']) {
  if (!files.tenantTest.includes(requirement)) throw new Error(`Production readiness tenant coverage is incomplete: missing ${requirement}`);
}
for (const requirement of ['Production readiness','data-pr15-export','data-pr15-signoff','mobile overflow']) {
  if (!files.browserTest.includes(requirement)) throw new Error(`Production readiness browser coverage is incomplete: missing ${requirement}`);
}

console.log('AKARI production readiness, sign-off and tenant backup validation passed.');
