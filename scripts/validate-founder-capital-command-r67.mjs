import fs from 'node:fs';

const js=fs.readFileSync('public/assets/founder-capital-command-r67.js','utf8');
const css=fs.readFileSync('public/assets/founder-capital-command-r67.css','utf8');
const html=fs.readFileSync('public/app/index.html','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

const fail=(message)=>{throw new Error(`R67 validation failed: ${message}`);};
const expect=(condition,message)=>{if(!condition)fail(message);};

const endpoints=[
  '/api/fundraising',
  '/api/fundraising/intelligence',
  '/api/fundraising/universe',
  '/api/fundraising/targeting',
  '/api/fundraising/outreach',
  '/api/fundraising/closing',
  '/api/fundraising/strategy',
];
endpoints.forEach((endpoint)=>expect(js.includes(`'${endpoint}'`),`missing canonical read endpoint ${endpoint}`));
expect(js.includes('Promise.allSettled'), 'module degradation must use independent settled reads');
expect(js.includes('Calculated Readiness'), 'Calculated Readiness label is missing');
expect(js.includes('does not overwrite stored readiness'), 'stored/manual readiness separation is missing');
expect(js.includes('NEXT REQUIRED ACTION'), 'ranked next required action is missing');
expect(js.includes('this command centre is read-only'), 'read-only governance disclosure is missing');
expect(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(js), 'command centre must not issue write requests');
expect(!/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[a-z_])/i.test(js), 'command centre must not contain SQL write logic');
expect(!js.includes('env.DB')&&!js.includes('D1'), 'command centre must not bind directly to D1');

const expectedWeights={
  targetAmount:7,instrument:7,owner:7,targetClose:7,thesisAndNextAction:7,
  dataRoomDocuments:10,noOverdueDiligence:10,noUnansweredQuestions:5,
  investorTargets:10,decisionMaker:5,nextInvestorAction:5,warmOrProgressedPath:5,
  noOverdueFollowUps:5,outreachEvidence:5,approvedOrSentOutreach:5,
};
let total=0;
for(const [key,value] of Object.entries(expectedWeights)){
  const pattern=new RegExp(`${key}\\s*:\\s*${value}\\b`);
  expect(pattern.test(js),`readiness weight ${key}=${value} is missing or changed`);
  total+=value;
}
expect(total===100,`readiness weights total ${total}, expected 100`);

for(const label of ['Overview','Readiness','Round','Data Room','Investors','Outreach','Diligence','Terms','Commitments','Closing','Investor Relations']){
  expect(js.includes(`'${label}'`),`navigation label ${label} is missing`);
}
for(const root of ['#capital-room-command-centre','#investor-universe-root','#fundraising-targeting-root','#fundraising-outreach-root','#fundraising-strategy-root','#fundraising-closing-centre']){
  expect(js.includes(root),`canonical handoff ${root} is missing`);
}
expect(js.includes('[data-dr-room='), 'Data Room must hand off to the existing Capital Room launcher');
expect(css.includes('.fcr67-shell'), 'R67 stylesheet shell is missing');
expect(css.includes('@media(max-width:650px)'), 'mobile layout guard is missing');
expect(html.includes('/assets/founder-capital-command-r67.css?v=1'), 'R67 CSS is not registered in app shell');
expect(html.includes('/assets/founder-capital-command-r67.js?v=1'), 'R67 JS is not registered in app shell');
expect(pkg.version==='0.5.12',`package version is ${pkg.version}, expected 0.5.12`);
expect(String(pkg.scripts?.validate||'').includes('validate-founder-capital-command-r67.mjs'),'R67 validator is not in npm validate');

console.log('R67 Founder Capital Room command validation passed');