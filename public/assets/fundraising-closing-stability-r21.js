(()=>{'use strict';
if(window.__akariClosingStabilityInstalled)return;
window.__akariClosingStabilityInstalled=true;
const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
if(!descriptor?.get||!descriptor?.set)return;
Object.defineProperty(Element.prototype,'innerHTML',{
  configurable:descriptor.configurable,
  enumerable:descriptor.enumerable,
  get(){return descriptor.get.call(this);},
  set(value){
    if(this instanceof HTMLElement&&this.id==='fundraising-closing-centre'){
      const next=String(value).replace('Legacy compatibility','Capital Room compatibility');
      if(this.__akariClosingLastHtml===next)return;
      this.__akariClosingLastHtml=next;
      descriptor.set.call(this,next);
      return;
    }
    descriptor.set.call(this,value);
  },
});
})();
