import fs from 'node:fs';

const required=[
  'db/migrations/0008_saas_workspace_admin.sql',
  'functions/lib/workspace-admin.js',
  'functions/api/workspace-admin/index.js',
  'functions/api/invitations/accept.js',
  'functions/_middleware.js',
  'public/accept-invite.html',
  'public/assets/workspace-admin-r75.js',
  'public/assets/workspace-admin-r75.css',
  'tests/saas-workspace-admin-r75-tenant-isolation.test.mjs',
  'public/app/index.html',
];
for(const file of required)if(!fs.existsSync(file))throw new Error(`R75 missing ${file}`);

const migration=fs.readFileSync('db/migrations/0008_saas_workspace_admin.sql','utf8');
for(const pattern of ['CREATE TABLE IF NOT EXISTS platform_admins','CREATE TABLE IF NOT EXISTS workspace_usage_snapshots','UNIQUE (user_id)'])if(!migration.includes(pattern))throw new Error(`R75 migration missing: ${pattern}`);

const lib=fs.readFileSync('functions/lib/workspace-admin.js','utf8');
for(const pattern of ['WORKSPACE_MODULES','workspaceUsage','workspaceSnapshot','createInvitation','hashInviteToken','acceptInvitation','provisionWorkspace','isPlatformAdmin','listPlatformWorkspaces','updateWorkspaceConfiguration','seat limit','token_hash'])if(!lib.toLowerCase().includes(pattern.toLowerCase()))throw new Error(`R75 domain engine missing: ${pattern}`);

const middleware=fs.readFileSync('functions/_middleware.js','utf8');
for(const pattern of ["t.status IN ('ACTIVE','TRIAL')",'isInvitationBootstrapRequest','preAuthIdentity','enabled_modules_json','moduleForRequest','module is not enabled'])if(!middleware.includes(pattern))throw new Error(`R75 auth/entitlement boundary missing: ${pattern}`);

const api=fs.readFileSync('functions/api/workspace-admin/index.js','utf8');
for(const pattern of ['requireRole','requireTenant','platform-create-workspace','platform-update-workspace','create-invitation','revoke-invitation','platform-add-admin','platform-revoke-admin','scope'])if(!api.includes(pattern))throw new Error(`R75 admin API missing: ${pattern}`);

const acceptApi=fs.readFileSync('functions/api/invitations/accept.js','utf8');
for(const pattern of ['preAuthIdentity','acceptInvitation','redirectUrl'])if(!acceptApi.includes(pattern))throw new Error(`R75 invitation endpoint missing: ${pattern}`);

const invitePage=fs.readFileSync('public/accept-invite.html','utf8');
for(const pattern of ['/api/invitations/accept','Cloudflare Access','Accept invitation'])if(!invitePage.includes(pattern))throw new Error(`R75 invite acceptance UI missing: ${pattern}`);

const ui=fs.readFileSync('public/assets/workspace-admin-r75.js','utf8');
for(const pattern of ['Workspace Administration','Platform control','Create workspace + owner invite','Pending invitations','Roles & permissions','Finance','Suspend','Reactivate','workspace-admin'])if(!ui.includes(pattern))throw new Error(`R75 UI missing: ${pattern}`);

const shell=fs.readFileSync('public/app/index.html','utf8');
for(const pattern of ['/assets/workspace-admin-r75.css?v=1','/assets/workspace-admin-r75.js?v=1'])if(!shell.includes(pattern))throw new Error(`R75 shell wiring missing: ${pattern}`);

console.log('R75 SaaS Workspace Administration validation passed');
