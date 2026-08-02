(()=>{'use strict';
function dedupe(){
  const nodes=[...document.querySelectorAll('#commercial-command-centre')];
  if(nodes.length<2)return;
  nodes.slice(0,-1).forEach(node=>node.remove());
}
let scheduled=false;
const observer=new MutationObserver(()=>{
  if(scheduled)return;
  scheduled=true;
  queueMicrotask(()=>{scheduled=false;dedupe();});
});
observer.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',dedupe);
})();
