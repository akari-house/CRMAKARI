(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const MODULES=['BD','REVENUE','DELIVERY','CAMPAIGNS','FUNDRAISING','RELATIONSHIPS','PORTAL','REPORTING'];
  const ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER','EXTERNAL_COLLABORATOR'];
  let state=null,platform=null,tab='workspace',loading=false;
  const api=async(url,init={})=>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`Request failed (${response.status})`);return payload;};
  const isSettings=()=>/\/settings\/?$/.test(location.pathname)||['Settings','Team'].includes($('#view-root .page-head h1')?.textContent?.trim());
  const fmtBytes=value=>{const n=Number(value||0);if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} MB`;return `${(n/1024/1024/1024).toFixed(2)} GB`;};
  const roleLabel=v=>String(v||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const checkedModules=(root)=>$$('[data-wa75-module]:checked',root).map(input=>input.value);
  const moduleChecks=(enabled=MODULES,prefix='')=>MODULES.map(module=>`<label class="wa75__module"><input type="checkbox" value="${module}" data-wa75-module="${esc(prefix)}" ${enabled.includes(module)?'checked':''}>${module}</label>`).join('');
  const field=(label,html,full=false)=>`<div class="wa75__field ${full?'is-full':''}"><label>${esc(label)}</label>${html}</div>`;
  const root=()=>$('#workspace-admin-r75');
  const post=(body)=>api('/api/workspace-admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

  function summary(){
    const w=state.workspace,u=state.usage;
    return `<div class="wa75__metrics"><div class="wa75__metric"><span>Status</span><strong>${esc(w.status)}</strong></div><div class="wa75__metric"><span>Plan</span><strong>${esc(w.planCode)}</strong></div><div class="wa75__metric"><span>Seats</span><strong>${esc(u.seatConsumption)} / ${esc(u.seatLimit)}</strong></div><div class="wa75__metric"><span>Storage</span><strong>${esc(fmtBytes(u.storageUsedBytes))} / ${esc(w.storageLimitMb)} MB</strong></div></div>`;
  }
  function workspaceForm(){
    const w=state.workspace;
    return `<section class="wa75__card"><h3>Workspace configuration</h3><form class="wa75__form" data-wa75-workspace-form>${field('Workspace name',`<input name="name" value="${esc(w.name)}" required>`)}${field('Workspace slug',`<input value="${esc(w.slug)}" disabled>`)}${field('Timezone',`<input name="timezone" value="${esc(w.timezone)}">`)}${field('Base currency',`<input name="baseCurrency" value="${esc(w.baseCurrency)}" maxlength="8">`)}${field('Logo URL',`<input name="logoUrl" value="${esc(w.logoUrl)}" placeholder="https://…">`,true)}<div class="wa75__modules">${moduleChecks(w.modules,'workspace')}</div><div class="wa75__submit"><button class="btn small" type="submit">Save workspace</button></div></form></section>`;
  }
  function inviteCard(){
    const invites=state.pendingInvitations||[];
    return `<section class="wa75__card"><h3>Invite team</h3><form class="wa75__form" data-wa75-invite-form>${field('Email','<input name="email" type="email" required placeholder="name@company.com">')}${field('Role',`<select name="role">${ROLES.map(role=>`<option value="${role}" ${role==='BD_MEMBER'?'selected':''}>${esc(roleLabel(role))}</option>`).join('')}</select>`)}<label class="wa75__module" style="grid-column:1/-1"><input name="financeAccess" type="checkbox"> Finance permission</label><div data-wa75-invite-result></div><div class="wa75__submit"><button class="btn small" type="submit">Create invitation</button></div></form><h3 style="margin-top:16px">Pending invitations</h3><div class="wa75__list">${invites.length?invites.map(inv=>`<div class="wa75__row"><div><strong>${esc(inv.email)}</strong><span>${esc(roleLabel(inv.role))} · expires ${esc(String(inv.expires_at||'').slice(0,10))}</span></div><div class="wa75__row-actions"><button class="btn small" data-wa75-revoke-invite="${esc(inv.id)}">Revoke</button></div></div>`).join(''):'<div class="wa75__empty">No pending invitations.</div>'}</div></section>`;
  }
  function teamCard(){
    const team=state.team||[];
    return `<section class="wa75__card" style="grid-column:1/-1"><h3>Roles & permissions</h3><div class="wa75__list">${team.map(member=>`<div class="wa75__row" data-wa75-member="${esc(member.membership_id)}"><div><strong>${esc(member.full_name)}</strong><span>${esc(member.email)} · <span class="wa75__badge" data-status="${esc(member.status)}">${esc(member.status)}</span></span></div><div class="wa75__row-actions"><select data-wa75-role>${ROLES.map(role=>`<option value="${role}" ${member.role===role?'selected':''}>${esc(roleLabel(role))}</option>`).join('')}</select><label class="wa75__module"><input type="checkbox" data-wa75-finance ${member.finance_access?'checked':''}>Finance</label><select data-wa75-status><option value="ACTIVE" ${member.status==='ACTIVE'?'selected':''}>Active</option><option value="SUSPENDED" ${member.status==='SUSPENDED'?'selected':''}>Suspended</option><option value="REVOKED">Revoke</option></select><button class="btn small" data-wa75-save-member>Save</button></div></div>`).join('')||'<div class="wa75__empty">No members found.</div>'}</div></section>`;
  }
  function workspaceView(){return summary()+`<div class="wa75__grid">${workspaceForm()}${inviteCard()}${teamCard()}</div>`;}

  function platformCreate(){
    return `<section class="wa75__card"><h3>Create Tenant #${(platform?.workspaces?.length||0)+1}</h3><form class="wa75__form" data-wa75-create-tenant>${field('Workspace name','<input name="name" required placeholder="Client workspace">')}${field('Slug','<input name="slug" placeholder="client-workspace">')}${field('Owner email','<input name="ownerEmail" type="email" required>')}${field('Plan code','<input name="planCode" value="FOUNDING">')}${field('Seat limit','<input name="userLimit" type="number" min="1" value="3">')}${field('Storage MB','<input name="storageLimitMb" type="number" min="1" value="500">')}${field('Status','<select name="status"><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option></select>')}${field('Trial days','<input name="trialDays" type="number" min="1" max="90" value="14">')}<div class="wa75__modules">${moduleChecks(MODULES,'new')}</div><div data-wa75-create-result></div><div class="wa75__submit"><button class="btn small" type="submit">Create workspace + owner invite</button></div></form></section>`;
  }
  function platformWorkspaces(){
    const rows=platform?.workspaces||[];
    return `<section class="wa75__card" style="grid-column:1/-1"><h3>All workspaces</h3><div class="wa75__platform-table">${rows.map(w=>`<div class="wa75__platform-row" data-wa75-platform-tenant="${esc(w.id)}"><div><strong>${esc(w.name)}</strong><br><small>${esc(w.slug)}</small></div><div><small>Status</small><br><span class="wa75__badge" data-status="${esc(w.status)}">${esc(w.status)}</span></div><div><small>Plan</small><br>${esc(w.plan_code)}</div><div><small>Seats</small><br>${esc(w.usage?.seatConsumption||0)} / ${esc(w.user_limit)}</div><div><small>Storage</small><br>${esc(fmtBytes(w.usage?.storageUsedBytes||0))}</div><div class="wa75__row-actions"><button class="btn small" data-wa75-toggle-tenant="${w.status==='SUSPENDED'?'ACTIVE':'SUSPENDED'}">${w.status==='SUSPENDED'?'Reactivate':'Suspend'}</button></div></div>`).join('')||'<div class="wa75__empty">No workspaces found.</div>'}</div></section>`;
  }
  function platformAdmins(){
    const admins=platform?.platformAdmins||[];
    return `<section class="wa75__card"><h3>Platform administrators</h3><form class="wa75__form" data-wa75-add-admin>${field('Existing CRM user email','<input name="email" type="email" required> ',true)}<div class="wa75__submit"><button class="btn small" type="submit">Add platform admin</button></div></form><div class="wa75__list" style="margin-top:10px">${admins.map(a=>`<div class="wa75__row"><div><strong>${esc(a.full_name)}</strong><span>${esc(a.email)}</span></div><button class="btn small" data-wa75-revoke-admin="${esc(a.id)}">Revoke</button></div>`).join('')}</div></section>`;
  }
  function platformView(){return `<div class="wa75__grid">${platformCreate()}${platformAdmins()}${platformWorkspaces()}</div>`;}

  function render(){
    const node=root();if(!node||!state)return;
    node.innerHTML=`<div class="wa75__head"><div><span class="wa75__eyebrow">CRM BY AKARI · R75</span><h2>Workspace Administration</h2><p>Create, configure and govern workspaces without engineering intervention.</p></div><div class="wa75__actions"><button class="btn small" data-wa75-refresh>Refresh</button></div></div>${state.platformAdmin?`<div class="wa75__tabs"><button class="btn small wa75__tab" data-wa75-tab="workspace" aria-selected="${tab==='workspace'}">This workspace</button><button class="btn small wa75__tab" data-wa75-tab="platform" aria-selected="${tab==='platform'}">Platform control</button></div>`:''}<div data-wa75-body>${tab==='platform'?platformView():workspaceView()}</div>`;
  }
  async function load(){
    if(loading)return;loading=true;
    try{state=await api('/api/workspace-admin');if(tab==='platform'&&state.platformAdmin)platform=await api('/api/workspace-admin?scope=platform');render();}
    catch(error){if(root())root().innerHTML=`<div class="wa75__error">${esc(error.message)}</div>`;}
    finally{loading=false;}
  }
  function ensure(){
    if(!isSettings()){root()?.remove();return;}
    if(root())return;
    const head=$('#view-root .page-head');if(!head)return;
    const node=document.createElement('section');node.id='workspace-admin-r75';node.className='wa75';node.innerHTML='<div class="wa75__empty">Loading workspace administration…</div>';head.insertAdjacentElement('afterend',node);load();
  }
  async function loadPlatform(){platform=await api('/api/workspace-admin?scope=platform');render();}
  async function saveMember(row){
    const id=row.dataset.wa75Member,role=$('[data-wa75-role]',row).value,status=$('[data-wa75-status]',row).value,financeAccess=$('[data-wa75-finance]',row).checked;
    await api(`/api/team/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({role,status,financeAccess})});await load();
  }

  document.addEventListener('submit',async event=>{
    const form=event.target;
    try{
      if(form.matches('[data-wa75-workspace-form]')){event.preventDefault();const data=new FormData(form);await post({action:'update-workspace',workspace:{name:data.get('name'),timezone:data.get('timezone'),baseCurrency:data.get('baseCurrency'),logoUrl:data.get('logoUrl'),modules:checkedModules(form)}});await load();return;}
      if(form.matches('[data-wa75-invite-form]')){event.preventDefault();const data=new FormData(form),result=await post({action:'create-invitation',email:data.get('email'),role:data.get('role'),financeAccess:data.get('financeAccess')==='on'}),box=$('[data-wa75-invite-result]',form);box.className='wa75__invite-result';box.innerHTML=`<strong>Invitation created.</strong><br>${esc(result.invitation.inviteUrl)}<br><button class="btn small" type="button" data-wa75-copy="${esc(result.invitation.inviteUrl)}">Copy invite link</button>`;await new Promise(resolve=>setTimeout(resolve,200));await load();return;}
      if(form.matches('[data-wa75-create-tenant]')){event.preventDefault();const data=new FormData(form),result=await post({action:'platform-create-workspace',workspace:{name:data.get('name'),slug:data.get('slug'),ownerEmail:data.get('ownerEmail'),planCode:data.get('planCode'),userLimit:Number(data.get('userLimit')),storageLimitMb:Number(data.get('storageLimitMb')),status:data.get('status'),trialDays:Number(data.get('trialDays')),modules:checkedModules(form)}}),box=$('[data-wa75-create-result]',form);box.className='wa75__invite-result';box.innerHTML=`<strong>${esc(result.workspace.name)} created.</strong><br>Owner invite: ${esc(result.ownerInvitation.inviteUrl)}<br><button class="btn small" type="button" data-wa75-copy="${esc(result.ownerInvitation.inviteUrl)}">Copy owner invite</button>`;await loadPlatform();return;}
      if(form.matches('[data-wa75-add-admin]')){event.preventDefault();const data=new FormData(form);await post({action:'platform-add-admin',email:data.get('email')});form.reset();await loadPlatform();return;}
    }catch(error){const box=form.querySelector('[data-wa75-invite-result],[data-wa75-create-result]');if(box){box.className='wa75__error';box.textContent=error.message;}else alert(error.message);}
  },true);

  document.addEventListener('click',async event=>{
    try{
      const tabButton=event.target.closest?.('[data-wa75-tab]');if(tabButton){tab=tabButton.dataset.wa75Tab;if(tab==='platform'&&!platform)await loadPlatform();else render();return;}
      if(event.target.closest?.('[data-wa75-refresh]')){if(tab==='platform')await loadPlatform();else await load();return;}
      const revokeInvite=event.target.closest?.('[data-wa75-revoke-invite]');if(revokeInvite){await post({action:'revoke-invitation',id:revokeInvite.dataset.wa75RevokeInvite});await load();return;}
      const memberSave=event.target.closest?.('[data-wa75-save-member]');if(memberSave){await saveMember(memberSave.closest('[data-wa75-member]'));return;}
      const copy=event.target.closest?.('[data-wa75-copy]');if(copy){await navigator.clipboard.writeText(copy.dataset.wa75Copy);copy.textContent='Copied';return;}
      const toggle=event.target.closest?.('[data-wa75-toggle-tenant]');if(toggle){const row=toggle.closest('[data-wa75-platform-tenant]'),workspace=(platform.workspaces||[]).find(w=>w.id===row.dataset.wa75PlatformTenant);if(!workspace)return;await post({action:'platform-update-workspace',tenantId:workspace.id,workspace:{name:workspace.name,status:toggle.dataset.wa75ToggleTenant,planCode:workspace.plan_code,userLimit:Number(workspace.user_limit),storageLimitMb:Number(workspace.storage_limit_mb),timezone:workspace.timezone,baseCurrency:workspace.base_currency,logoUrl:workspace.logo_url||'',modules:workspace.modules||MODULES}});await loadPlatform();return;}
      const revokeAdmin=event.target.closest?.('[data-wa75-revoke-admin]');if(revokeAdmin){await post({action:'platform-revoke-admin',id:revokeAdmin.dataset.wa75RevokeAdmin});await loadPlatform();return;}
    }catch(error){alert(error.message||'Workspace administration action failed');}
  },true);

  const observer=new MutationObserver(()=>queueMicrotask(ensure));observer.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',ensure);ensure();
})();
