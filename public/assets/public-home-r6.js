const nodeDetails={
  lead:{project:'KlineO',stage:'Qualified lead',owner:'Muaz Xinthi',status:'Ready',next:'Confirm project goals and schedule discovery.',width:'25%'},
  call:{project:'Yokai',stage:'Discovery call',owner:'BD Lead',status:'Due today',next:'Capture budget, timing, decision process, and fit.',width:'42%'},
  proposal:{project:'KlineO',stage:'Commercial scope',owner:'Muaz Xinthi',status:'Approval gate',next:'Review deliverables and release the proposal.',width:'72%'},
  won:{project:'AKARI House',stage:'Client onboarding',owner:'Delivery Lead',status:'Kickoff ready',next:'Confirm access, assets, milestones, and reporting.',width:'88%'},
  revenue:{project:'Yokai',stage:'Payment received',owner:'Finance',status:'Reconciled',next:'Close liabilities and prepare the performance report.',width:'100%'}
};

const details={
  project:document.querySelector('[data-inspector-project]'),
  stage:document.querySelector('[data-inspector-stage]'),
  owner:document.querySelector('[data-inspector-owner]'),
  status:document.querySelector('[data-inspector-status]'),
  next:document.querySelector('[data-inspector-next]'),
  bar:document.querySelector('[data-prob-bar]')
};

document.querySelectorAll('[data-node]').forEach((node)=>node.addEventListener('click',()=>{
  document.querySelectorAll('[data-node]').forEach((item)=>item.classList.remove('active'));
  node.classList.add('active');
  const detail=nodeDetails[node.dataset.node];
  details.project.textContent=detail.project;
  details.stage.textContent=detail.stage;
  details.owner.textContent=detail.owner;
  details.status.textContent=detail.status;
  details.next.textContent=detail.next;
  details.bar.style.width=detail.width;
}));

const form=document.querySelector('#waitlist-form');
const status=document.querySelector('#waitlist-status');
form?.addEventListener('submit',async(event)=>{
  event.preventDefault();
  status.textContent='Submitting your interest…';
  const payload=Object.fromEntries(new FormData(form).entries());
  try{
    const response=await fetch('/api/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Unable to submit interest');
    form.reset();
    status.textContent=`Thanks — ${result.company||'your company'} is on the waitlist${result.position?` at position #${result.position}`:''}.`;
  }catch(error){status.textContent=error.message||'Unable to submit your interest.';}
});
