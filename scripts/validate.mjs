import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

const required = [
  'public/index.html',
  'public/assets/app.css',
  'public/assets/app.js',
  'functions/_middleware.js',
  'functions/api/[[path]].js',
  'db/migrations/0001_core.sql',
  'README.md',
];

for (const file of required) {
  await access(file, constants.R_OK);
}

const jsFiles = [
  'public/assets/app.js',
  'public/assets/api-client.js',
  'functions/_middleware.js',
  'functions/api/[[path]].js',
  'functions/lib/response.js',
  'functions/lib/db.js',
  'functions/lib/demo-data.js',
  'functions/lib/permissions.js',
];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const html = await readFile('public/index.html', 'utf8');
if (!html.includes('AKARI CRM') || !html.includes('/assets/app.css')) {
  throw new Error('The application shell is incomplete');
}

console.log('AKARI CRM starter validation passed.');

