import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const middleware=read('functions/_middleware.js');
const enter=read('functions/enter-crm.js');
const access=read('functions/lib/portal-access.js');
const admin=read('functions/api/portal-admin/index.js');
const home=read('functions/api/portal/index.js');
const project=read('functions/api/portal/project/[id].js');
const shell=read('functions/portal/[[path]].js');
const portalHtml=read('public/portal/index.html');
const portalJs=read('public/assets/external-portal-r68.js');
const appHtml=read('public/app/index.html');
const adminJs=read('public/assets/portal-access-admin-r68.js');
const pkg=JSON.parse(read('package.json'));
const fail=(message)=>{throw new Error(`R68 validation failed: ${message}`);};
const expect=(condition,message)=>{if(!condition)fail(message);};

expect(middleware.includes("membership.role==='EXTERNAL_COLLABORATOR'"),'middleware external-collaborator boundary is missing');
expect(middleware.includes('externalPortalAllowed'),'portal-only middleware allowlist is missing');
expect(middleware.includes("path.startsWith('/api/portal/')"),'portal API allowlist is missing');
expect(middleware.includes('/(?:app|portal)\\/([^/]+)'), 'tenant routing must recognize /app and /portal');
expect(middleware.includes('External collaborator access is limited to the AKARI client/founder portal'),'internal CRM denial message is missing');
expect(enter.includes("auth.role==='EXTERNAL_COLLABORATOR'"),'enter-crm must route external collaborators separately');
expect(enter.includes('/portal/${encodeURIComponent(slug)}'),'external redirect must target tenant portal');

expect(access.includes("PORTAL_ACCESS_ACTIVITY='PORTAL_ACCESS_GRANT'"),'audited portal grant activity is missing');
expect(access.includes("PORTAL_ACCESS_MARKER='AKARI_EXTERNAL_PORTAL_ACCESS_V1'"),'portal grant marker is missing');
expect(access.includes("grant.projectId===projectId&&item.status==='ACTIVE'")||access.includes("item.projectId===projectId&&item.status==='ACTIVE'"),'active explicit project grant check is missing');
expect(access.includes("auth.role!=='EXTERNAL_COLLABORATOR'"),'project grant helper must distinguish external users');

expect(admin.includes("requireRole(auth,MANAGE_ROLES)"),'portal administration must require Owner/Admin');
expect(admin.includes("const MANAGE_ROLES=['OWNER','ADMIN']"),'portal admin role list must remain Owner/Admin only');
expect(admin.includes("tm.role='EXTERNAL_COLLABORATOR'"),'portal grants must target External Collaborators only');
expect(admin.includes('PORTAL_ACCESS_GRANTED')&&admin.includes('PORTAL_ACCESS_REVOKED'),'grant/revoke audit events are missing');
expect(adminJs.includes("role:'EXTERNAL_COLLABORATOR'"),'Settings panel must create portal-only collaborators explicitly');
expect(adminJs.includes('financeAccess:false'),'external collaborator creation must not grant finance access');

expect(home.includes("auth.role!=='EXTERNAL_COLLABORATOR'"),'portal home must reject internal/non-external roles');
expect(home.includes('loadPortalGrants')&&home.includes("item.status==='ACTIVE'"),'portal home must use active explicit grants');
expect(project.includes('requirePortalProject'),'project API must use explicit project grant helper');
expect(project.includes("owner_user_id=?"),'portal tasks must be limited to the external user');
expect(project.includes("tenant_id=? AND project_id=? AND id=? AND owner_user_id=?"),'task mutation must bind tenant, project, task and owner');
expect(project.includes('answerDiligence')&&project.includes('sanitizeInvestorQuestion'),'founder diligence answers must use governed existing question model');
expect(project.includes('internalNotesExcluded:true')&&project.includes('privateInvestorContactsExcluded:true')&&project.includes('financeExcluded:true'),'portal disclosure/exclusion contract is incomplete');
expect(!/\bFROM\s+(payments|invoices|referrals)\b/i.test(project),'portal project API must not query finance/payment tables');
expect(!/\b(contact_email|contactEmail|primary_contact|billingEmail)\b/.test(project),'portal project API must not expose private contact fields');

expect(shell.includes("auth.role!=='EXTERNAL_COLLABORATOR'"),'protected portal shell must require External Collaborator role');
expect(shell.includes("headers.set('cache-control','no-store')"),'portal shell must be no-store');
expect(shell.includes("requestedSlug!==String(auth.tenantSlug"),'portal shell must enforce tenant slug match');
expect(portalHtml.includes('/assets/external-portal-r68.css?v=1')&&portalHtml.includes('/assets/external-portal-r68.js?v=1'),'external portal assets are not registered');
expect(!portalHtml.includes('/assets/crm.js')&&!portalHtml.includes('/assets/global-flow-v1.js'),'external portal must not load internal CRM application assets');
expect(portalJs.includes('/api/portal/project/')&&portalJs.includes('/api/portal'),'portal UI must use only portal APIs');
expect(!/fetch\(['"`]\/api\/(?!portal)/.test(portalJs),'external portal UI must not call ordinary internal APIs');
expect(portalJs.includes('Internal AKARI CRM data is not exposed here'),'portal privacy message is missing');
expect(portalJs.includes('finance records')&&portalJs.includes('Creator/KOL payments'),'portal exclusion notice is missing');
expect(appHtml.includes('/assets/portal-access-admin-r68.css?v=1')&&appHtml.includes('/assets/portal-access-admin-r68.js?v=1'),'internal portal access admin assets are not registered');
expect(pkg.version==='0.5.13',`package version is ${pkg.version}, expected 0.5.13`);
expect(String(pkg.scripts?.validate||'').includes('validate-external-portal-r68.mjs'),'R68 validator is not in npm validate');

console.log('R68 external founder/client portal validation passed');