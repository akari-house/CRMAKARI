import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { fetchHouseCreatorFeed, buildAkariHouseCreatorDirectory } from '../lib/akari-house-creator-directory.js';

async function loadCampaigns(db,tenantId){
  return all(db,`
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,p.name AS project_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ?
    ORDER BY c.updated_at DESC
  `,[tenantId]);
}
async function loadPartners(db,tenantId){
  return all(db,`
    SELECT id,name,partner_type,status,website,x_url,contact_name
    FROM partners
    WHERE tenant_id = ?
    ORDER BY name COLLATE NOCASE
  `,[tenantId]);
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;
    const tenantId=requireTenant(auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const [campaigns,partners]=await Promise.all([loadCampaigns(context.env.DB,tenantId),loadPartners(context.env.DB,tenantId)]);
    let feed={source:'AKARI_HOUSE_PUBLIC_CREATOR_DIRECTORY',schemaVersion:null,publicProfilesOnly:true,profileDataStatus:'PROFILE_PROVIDED',generatedAt:null,items:[]};
    let sourceAvailable=true;
    let sourceWarning=null;
    try{
      feed=await fetchHouseCreatorFeed(fetch,{url:context.env.AKARI_HOUSE_CREATOR_FEED_URL||'https://akarihouse.com/api/crm/creators',limit:500});
    }catch(cause){
      sourceAvailable=false;
      sourceWarning='AKARI House Creator profiles are temporarily unavailable. Historical CRM talent remains available.';
      console.warn('AKARI House Creator feed unavailable',cause?.message||cause);
    }
    const directory=buildAkariHouseCreatorDirectory(feed,campaigns,partners);
    return json({
      directory:{...directory,sourceAvailable,sourceWarning},
      methodology:{
        version:'R8.5K-1',identitySource:'AKARI_HOUSE',profileDataStatus:'PROFILE_PROVIDED',publicProfilesOnly:true,
        tenantPrivatePerformance:true,approvedOnlyPerformance:true,noAutomaticLegacyLinkingWhenAmbiguous:true,noSocialOAuthRequired:true,
      },
    });
  }catch(cause){
    return error(cause.message||'Creator directory could not be loaded',Number(cause.status||500));
  }
}
