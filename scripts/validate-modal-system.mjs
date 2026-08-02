import { readFile } from 'node:fs/promises';

const css = await readFile('public/assets/modal-system-r9.css', 'utf8');
const selectContrast = await readFile('public/assets/select-option-contrast-v1.css', 'utf8');
const customSelectCss = await readFile('public/assets/custom-select-v2.css', 'utf8');
const customSelectJs = await readFile('public/assets/custom-select-v2.js', 'utf8');
const js = await readFile('public/assets/modal-system-r9.js', 'utf8');
const html = await readFile('public/app/index.html', 'utf8');
const sw = await readFile('public/sw.js', 'utf8');

for (const token of ['.ak-modal-standard', '.ak-modal--wide', '.commercial-form-grid', '.revenue-field-grid', 'scrollbar-gutter:stable', 'body.ak-modal-open']) {
  if (!css.includes(token)) throw new Error(`Modal system CSS missing ${token}`);
}
for (const token of ['color-scheme: dark', 'select option', 'background-color: #0d121a', 'color: #f7f8fb']) {
  if (!selectContrast.includes(token)) throw new Error(`Select option contrast CSS missing ${token}`);
}
for (const token of ['.ak-select__trigger', '.ak-select__menu', '.ak-select__option', 'z-index:100000', 'background:#0d121a']) {
  if (!customSelectCss.includes(token)) throw new Error(`Custom select CSS missing ${token}`);
}
for (const token of ['function enhance(select)', "setAttribute('role', 'listbox')", "dispatchEvent(new Event('change'", 'MutationObserver', 'positionMenu(control)']) {
  if (!customSelectJs.includes(token)) throw new Error(`Custom select runtime missing ${token}`);
}
for (const token of ['normalizeTaskNavigation', 'normalizeDialog', "controls.length >= 8", "[data-route=\"day\"]", 'Open Tasks']) {
  if (!js.includes(token)) throw new Error(`Modal system runtime missing ${token}`);
}
for (const token of ['/assets/modal-system-r9.css?v=1', '/assets/select-option-contrast-v1.css?v=1', '/assets/custom-select-v2.css?v=1', '/assets/custom-select-v2.js?v=1', '/assets/modal-system-r9.js?v=1']) {
  if (!html.includes(token)) throw new Error(`Protected shell missing ${token}`);
}
for (const token of ['akari-crm-shell-v42', './assets/custom-select-v2.css?v=1', './assets/custom-select-v2.js?v=1', 'runtime=v42', 'Promise.allSettled', 'cacheFirst(request)']) {
  if (!sw.includes(token)) throw new Error(`Service worker missing ${token}`);
}

console.log('AKARI modal system, custom selects and cache-first shell validation passed');