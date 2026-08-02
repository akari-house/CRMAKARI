import { json,error,readJson } from '../lib/response.js';

const text=(value,max=500)=>String(value??'').trim().slice(0,max);
const allowedBudgets=new Set(['Under $50','$50–$100','$100–$250','$250–$500','$500–$1,000','$1,000+','Enterprise / Let\'s talk']);
const allowedPackages=new Set(['BD','BD + CRM','BD + CRM + Fundraising','Full platform + Data']);
const allowedCommitments=new Set(['Monthly','Annual']);

export async function onRequestPost(context){
  try{
    const body=await readJson(context.request);
    if(text(body.website,200))return json({joined:true});
    const name=text(body.name,120);
    const email=text(body.email,240).toLowerCase();
    const company=text(body.company,180);
    const consent=body.consent==='yes';
    if(!name||!company||!/^\S+@\S+\.\S+$/.test(email)||!consent)return error('Please enter your name, work email, company and contact consent',422);
    const monthlyBudget=text(body.monthlyBudget,80);
    const packageInterest=text(body.package,80);
    const commitment=text(body.commitment,40);
    if(!allowedBudgets.has(monthlyBudget))return error('Please select a valid monthly budget range',422);
    if(!allowedPackages.has(packageInterest)||!allowedCommitments.has(commitment))return error('Please select a valid package and preferred commitment',422);
    if(!context.env.DB)return json({joined:true,demo:true,company});
    await context.env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_waitlist (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,company TEXT NOT NULL,company_type TEXT,team_size TEXT,current_system TEXT,primary_use_case TEXT,monthly_budget TEXT,priority_features_json TEXT,consent_at TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
    const now=new Date().toISOString();
    const id=`wait_${crypto.randomUUID()}`;
    await context.env.DB.prepare(`INSERT INTO public_waitlist (id,email,name,company,company_type,team_size,current_system,primary_use_case,monthly_budget,priority_features_json,consent_at,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,company=excluded.company,company_type=excluded.company_type,current_system=excluded.current_system,primary_use_case=excluded.primary_use_case,monthly_budget=excluded.monthly_budget,priority_features_json=excluded.priority_features_json,consent_at=excluded.consent_at`).bind(id,email,name,company,packageInterest,'',commitment,packageInterest,monthlyBudget,JSON.stringify({package:packageInterest,commitment}),now,'PUBLIC_HOME',now).run();
    const count=await context.env.DB.prepare('SELECT COUNT(*) AS total FROM public_waitlist').first();
    return json({joined:true,company,position:Number(count?.total||0)});
  }catch(cause){return error(cause.message||'Unable to submit interest',Number(cause.status||500));}
}

export async function onRequestGet(){return error('Method not allowed',405);}
