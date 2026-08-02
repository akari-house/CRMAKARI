(()=>{
  const ROOTS='#modal-root,#commercial-modal-root,#work-os-modal-root';
  const enhanced=new WeakSet();
  let openControl=null;

  function close(control,restoreFocus=false){
    if(!control)return;
    control.root.classList.remove('is-open');
    control.button.setAttribute('aria-expanded','false');
    control.menu.hidden=true;
    if(openControl===control)openControl=null;
    if(restoreFocus)control.button.focus();
  }

  function optionEntries(select){
    const entries=[];
    [...select.children].forEach(child=>{
      if(child.tagName==='OPTGROUP'){
        entries.push({group:child.label});
        [...child.children].forEach(option=>entries.push({option}));
      }else if(child.tagName==='OPTION')entries.push({option:child});
    });
    return entries;
  }

  function enhance(select){
    if(enhanced.has(select)||select.multiple||Number(select.size)>1||select.dataset.nativeSelect==='true')return;
    enhanced.add(select);
    const root=document.createElement('div');
    root.className='ak-select';
    const button=document.createElement('button');
    button.type='button';
    button.className='ak-select__button';
    button.setAttribute('aria-haspopup','listbox');
    button.setAttribute('aria-expanded','false');
    const menu=document.createElement('div');
    menu.className='ak-select__menu';
    menu.hidden=true;
    menu.setAttribute('role','listbox');
    const menuId=`ak-select-${Math.random().toString(36).slice(2)}`;
    menu.id=menuId;
    button.setAttribute('aria-controls',menuId);

    select.parentNode.insertBefore(root,select);
    root.append(select,button,menu);
    select.classList.add('ak-select__native');

    const control={select,root,button,menu,buttons:[]};

    function sync(){
      const chosen=select.selectedOptions[0];
      button.textContent=chosen?.textContent?.trim()||select.getAttribute('placeholder')||'Select';
      button.disabled=select.disabled;
      control.buttons.forEach((item,index)=>{
        const option=[...select.options][index];
        if(!option)return;
        item.setAttribute('aria-selected',String(option.selected));
        item.disabled=option.disabled;
      });
    }

    function rebuild(){
      menu.replaceChildren();
      control.buttons=[];
      let optionIndex=0;
      optionEntries(select).forEach(entry=>{
        if(entry.group){
          const label=document.createElement('div');
          label.className='ak-select__group';
          label.textContent=entry.group;
          menu.appendChild(label);
          return;
        }
        const option=entry.option;
        const item=document.createElement('button');
        item.type='button';
        item.className='ak-select__option';
        item.setAttribute('role','option');
        item.dataset.index=String(optionIndex++);
        item.textContent=option.textContent;
        item.disabled=option.disabled;
        item.addEventListener('click',()=>{
          if(option.disabled)return;
          select.value=option.value;
          select.dispatchEvent(new Event('input',{bubbles:true}));
          select.dispatchEvent(new Event('change',{bubbles:true}));
          sync();
          close(control,true);
        });
        control.buttons.push(item);
        menu.appendChild(item);
      });
      sync();
    }

    function open(){
      if(button.disabled)return;
      if(openControl&&openControl!==control)close(openControl);
      root.classList.add('is-open');
      button.setAttribute('aria-expanded','true');
      menu.hidden=false;
      openControl=control;
      const selected=control.buttons.find(item=>item.getAttribute('aria-selected')==='true')||control.buttons.find(item=>!item.disabled);
      selected?.focus({preventScroll:true});
      selected?.scrollIntoView({block:'nearest'});
    }

    button.addEventListener('click',()=>root.classList.contains('is-open')?close(control):open());
    button.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();open();}
    });
    menu.addEventListener('keydown',event=>{
      const available=control.buttons.filter(item=>!item.disabled);
      const current=available.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();close(control,true);return;}
      if(event.key==='Tab'){close(control);return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        const delta=event.key==='ArrowDown'?1:-1;
        available[(current+delta+available.length)%available.length]?.focus();
      }
      if(event.key==='Home'){event.preventDefault();available[0]?.focus();}
      if(event.key==='End'){event.preventDefault();available.at(-1)?.focus();}
    });
    select.addEventListener('change',sync);
    new MutationObserver(rebuild).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label']});
    rebuild();
  }

  function scan(node=document){
    const scope=node.querySelectorAll?node:document;
    scope.querySelectorAll(`${ROOTS} select`).forEach(enhance);
  }

  document.addEventListener('pointerdown',event=>{
    if(openControl&&!openControl.root.contains(event.target))close(openControl);
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&openControl)close(openControl,true);},true);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);}))).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
})();
