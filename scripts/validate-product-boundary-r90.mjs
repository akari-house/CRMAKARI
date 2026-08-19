import { readFileSync } from 'node:fs';
import { renderInviteOnlyPublicEntry } from '../functions/lib/public-entry.js';

const failures = [];
const rawHome = readFileSync('public/index.html', 'utf8');
const renderedHome = renderInviteOnlyPublicEntry(rawHome);
const login = readFileSync('public/login.html', 'utf8');

const requireText = (source, value, label) => {
  if (!source.includes(value)) failures.push(`${label} is missing: ${value}`);
};
const forbidText = (source, value, label) => {
  if (source.includes(value)) failures.push(`${label} still contains: ${value}`);
};

requireText(renderedHome, 'CRM by AKARI', 'Rendered CRM homepage');
requireText(renderedHome, 'CRM access · Invite only', 'Rendered CRM homepage');
forbidText(renderedHome, 'AKARI House / ', 'Rendered CRM homepage');
forbidText(
  renderedHome,
  '<span>AKARI House<small>Illustrative workspace</small></span>',
  'Rendered CRM homepage',
);
forbidText(renderedHome, '>AKARI login<', 'Rendered CRM homepage');
forbidText(renderedHome, '>AKARI team login<', 'Rendered CRM homepage');

requireText(login, 'Welcome to AKARI CRM', 'CRM login');
requireText(login, 'Continue to CRM workspace', 'CRM login');
forbidText(login, 'AKARI House is Customer 001', 'CRM login');

const apiMiddleware = readFileSync('functions/api/v1/_middleware.js', 'utf8');
requireText(apiMiddleware, "auth?.role!=='API'", 'CRM API middleware');
requireText(apiMiddleware, '!auth?.tenantId', 'CRM API middleware');
requireText(apiMiddleware, "auth.scopes.includes(required)", 'CRM API middleware');

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('R90 CRM product boundary validation passed.');
