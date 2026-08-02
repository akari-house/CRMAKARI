import { readFile } from 'node:fs/promises';

const css = await readFile('public/assets/modal-system-r9.css', 'utf8');
const js = await readFile('public/assets/modal-system-r9.js', 'utf8');
const html = await readFile('public/app/index.html', 'utf8');
const sw = await readFile('public/sw.js', 'utf8');

for (const token of ['.ak-modal-standard', '.ak-modal--wide', '.commercial-form-grid', '.revenue-field-grid', 'scrollbar-gutter:stable', 'body.ak-modal-open']) {
  if (!css.includes(token)) throw new Error(`Modal system CSS missing ${token}`);
}
for (const token of ['normalizeTaskNavigation', 'normalizeDialog', "controls.length >= 8", "[data-route=\"day\"]", 'Open Tasks']) {
  if (!js.includes(token)) throw new Error(`Modal system runtime missing ${token}`);
}
for (const token of ['/assets/modal-system-r9.css?v=1', '/assets/modal-system-r9.js?v=1']) {
  if (!html.includes(token)) throw new Error(`Protected shell missing ${token}`);
}
for (const token of ['akari-crm-shell-v40', './assets/modal-system-r9.css?v=1', './assets/modal-system-r9.js?v=1', 'runtime=v40']) {
  if (!sw.includes(token)) throw new Error(`Service worker missing ${token}`);
}

console.log('AKARI modal system and Tasks navigation validation passed');
