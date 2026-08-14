import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const baseUrl=String(process.env.AKARI_BASE_URL||'https://crm.akarihouse.com').replace(/\/$/,'');
const pagesUrl=String(process.env.AKARI_PAGES_URL||'https://crmakari.pages.dev').replace(/\/$/,'');
const expectedVersion=String(process.env.AKARI_EXPECTED_VERSION||pkg.version).trim();
const expectedSha=String(process.env.AKARI_EXPECTED_SHA||'').trim();
const reportPath=String(process.env.AKARI_ACCEPTANCE_REPORT||'production-acceptance-report.json');
const startedAt=new Date().toISOString();
const results=[];

function add(name,ok,details={}){
  const row={name,ok:Boolean(ok),...details};
  results.push(row);
  console.log(`${ok?'PASS':'FAIL'} ${name}${details.status?` [HTTP ${details.status}]`:''}${details.message?` - ${details.message}`:''}`);
}

async function request(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20_000);
  try{
    return await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'user-agent':'crm-by-akari-production-acceptance/1.0',...(options.headers||{})},...options});
  }finally{
    clearTimeout(timer);
  }
}

async function check(name,fn){
  try{await fn();}
  catch(error){add(name,false,{message:error?.message||String(error)});}
}

const protectedStatuses=new Set([301,302,303,307,308,401,403]);
const reachable=status=>status>=200&&status<500&&status!==404;

await check('production homepage reachable',async()=>{
  const res=await request(`${baseUrl}/`);
  add('production homepage reachable',reachable(res.status),{status:res.status,message:reachable(res.status)?undefined:'homepage is unavailable'});
});

await check('production security headers',async()=>{
  const res=await request(`${baseUrl}/`,{method:'HEAD'});
  const nosniff=(res.headers.get('x-content-type-options')||'').toLowerCase()==='nosniff';
  const frame=(res.headers.get('x-frame-options')||'').toUpperCase()==='DENY';
  const csp=(res.headers.get('content-security-policy')||'').toLowerCase().includes("frame-ancestors 'none'");
  add('production security headers',nosniff&&frame&&csp,{status:res.status,message:`nosniff=${nosniff}, frame-deny=${frame}, frame-ancestors=${csp}`});
});

await check('release metadata matches deployment',async()=>{
  const res=await request(`${baseUrl}/release.json`,{headers:{accept:'application/json'}});
  if(res.status!==200){add('release metadata matches deployment',false,{status:res.status,message:'release.json is not publicly readable after deployment'});return;}
  const body=await res.json();
  const versionOk=body?.version===expectedVersion;
  const shaOk=!expectedSha||body?.commit===expectedSha;
  add('release metadata matches deployment',versionOk&&shaOk,{status:res.status,message:`version=${body?.version||'missing'}, commit=${body?.commit||'missing'}`});
});

await check('custom-domain app is access protected',async()=>{
  const res=await request(`${baseUrl}/app/akari-house/dashboard`);
  add('custom-domain app is access protected',protectedStatuses.has(res.status),{status:res.status,message:protectedStatuses.has(res.status)?undefined:'protected app route was accessible without an authenticated identity'});
});

await check('custom-domain health endpoint is protected',async()=>{
  const res=await request(`${baseUrl}/api/system-health`);
  add('custom-domain health endpoint is protected',protectedStatuses.has(res.status),{status:res.status,message:protectedStatuses.has(res.status)?undefined:'system health exposed tenant data without authentication'});
});

await check('pages.dev deployment reachable',async()=>{
  const res=await request(`${pagesUrl}/`);
  add('pages.dev deployment reachable',reachable(res.status),{status:res.status,message:reachable(res.status)?undefined:'Pages deployment is unavailable'});
});

await check('pages.dev API still fails closed',async()=>{
  const res=await request(`${pagesUrl}/api/system-health`);
  const safe=protectedStatuses.has(res.status);
  add('pages.dev API still fails closed',safe,{status:res.status,message:safe?undefined:'Pages default hostname can reach protected API without authentication'});
});

await check('service worker reachable',async()=>{
  const res=await request(`${baseUrl}/sw.js`);
  const ok=res.status===200||protectedStatuses.has(res.status);
  add('service worker reachable',ok,{status:res.status,message:ok?undefined:'service worker is unavailable'});
});

const failures=results.filter(result=>!result.ok);
const report={
  service:'crm-by-akari',
  baseUrl,
  pagesUrl,
  expectedVersion,
  expectedSha:expectedSha||null,
  startedAt,
  completedAt:new Date().toISOString(),
  passed:failures.length===0,
  totals:{checks:results.length,passed:results.length-failures.length,failed:failures.length},
  results,
};
fs.writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
console.log(`Production acceptance report written to ${reportPath}.`);
if(failures.length){
  console.error(`CRM by AKARI production acceptance failed (${failures.length}/${results.length} checks).`);
  process.exitCode=1;
}else{
  console.log(`CRM by AKARI production acceptance passed (${results.length}/${results.length} checks).`);
}
