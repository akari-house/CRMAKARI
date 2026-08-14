import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as portalPrivacy,__portalPrivacyForTest } from '../functions/api/portal/project/[id]/_middleware.js';

test('V1 Founder Data Room response strips internal note and linkage fields recursively',()=>{
  const input={
    requirements:[{id:'req_1',title:'Cap table',notes:'Internal team note',updated_by:'user_internal'}],
    documents:[{id:'doc_1',title:'Deck',notes:'Internal document note',versions:[{id:'v1',change_note:'Internal revision rationale',checksum:'private-checksum'}]}],
    diligence:[{id:'d1',title:'Question',internal_notes:'Do not show founder',investor_pipeline_id:'target_1',founder_response:'Founder-visible answer'}],
  };
  const output=__portalPrivacyForTest.sanitize(input,{dataRoom:true});
  const serialized=JSON.stringify(output);
  for(const forbidden of ['Internal team note','Internal document note','Internal revision rationale','private-checksum','Do not show founder','target_1','updated_by','internal_notes','investor_pipeline_id'])assert.equal(serialized.includes(forbidden),false,`leaked ${forbidden}`);
  assert.equal(output.diligence[0].founder_response,'Founder-visible answer');
  assert.equal(output.documents[0].title,'Deck');
});

test('V1 Founder Data Room middleware adds privacy evidence header and preserves response status',async()=>{
  const context={
    request:new Request('https://crm.test/api/portal/project/project_a/data-room'),
    next:async()=>new Response(JSON.stringify({requirements:[{id:'r1',notes:'private'}]}),{status:200,headers:{'content-type':'application/json; charset=utf-8'}}),
  };
  const response=await portalPrivacy(context);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-akari-portal-privacy'),'founder-safe');
  const payload=await response.json();
  assert.deepEqual(payload,{requirements:[{id:'r1'}]});
});

test('V1 nested portal middleware does not strip ordinary founder-visible notes outside Data Room',()=>{
  const output=__portalPrivacyForTest.sanitize({item:{notes:'Founder onboarding note',internal_notes:'Internal only'}},{dataRoom:false});
  assert.equal(output.item.notes,'Founder onboarding note');
  assert.equal(Object.hasOwn(output.item,'internal_notes'),false);
});
