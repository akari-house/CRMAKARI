import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const commit=String(process.env.AKARI_RELEASE_SHA||process.env.GITHUB_SHA||'local').trim();
const metadata={
  service:'crm-by-akari',
  version:pkg.version,
  commit,
  generatedAt:new Date().toISOString(),
};

fs.writeFileSync(new URL('../public/release.json',import.meta.url),`${JSON.stringify(metadata,null,2)}\n`,'utf8');
console.log(`CRM by AKARI release metadata generated for ${metadata.version} (${metadata.commit}).`);
