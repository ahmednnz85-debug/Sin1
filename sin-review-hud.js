/* Sîn — Babylonian icon-only touch controls. Review branch; no changes to main. */
(function(){
'use strict';
const icons={
  axe:'<path d="M7 27 26 6M22 4c7 1 10 6 9 13-6-3-9-2-14 2l-6-6C16 9 18 6 22 4Z"/><path d="m10 22-4 5m17-20-3 4"/>',
  light:'<path d="M9 28 25 5m-6-1c7 0 11 4 11 11-6-1-9 1-13 5l-5-6c3-4 5-7 7-10Z"/><path d="m6 21 6 6"/>',
  heavy:'<path d="M5 27 24 7M21 3c7 1 11 7 9 14-6-2-9 0-14 4l-7-7c6-7 8-10 12-11Z"/><path d="m5 9 4 1m-2-7 4 4M28 26l3 3m-7-1 1 4"/>',
  dodge:'<path d="M21 5 11 13l7 4-9 12M12 5l8 1 4 8M24 24l6 1m-23-8-5 3m4-10-4-1"/>',
  guard:'<path d="M16 3 29 8v9c0 9-6 13-13 16C9 30 3 26 3 17V8L16 3Z"/><path d="M16 8v18M8 17h16"/>',
  interact:'<path d="m8 17 2-5c1-2 4-1 4 1V6c0-3 5-3 5 0v8-5c0-3 4-3 4 0v7c2-2 5-1 5 2v4c0 5-4 8-11 8-7 0-10-4-11-9l-2-5c-1-3 3-5 4 1Z"/>'
};
const labels={axe:'سحب أو إرجاع الفأس',light:'ضربة الفأس',heavy:'ضربة ثقيلة',dodge:'تفادي',guard:'دفاع',interact:'تفاعل'};
let root=null,callbacks=null,armed=false;
function makeButton(key){
 const b=document.createElement('button');b.type='button';b.className='sin-action sin-action-'+key;b.dataset.action=key;b.setAttribute('aria-label',labels[key]);b.title=labels[key];
 b.innerHTML='<svg viewBox="0 0 36 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'+icons[key]+'</svg>';
 const begin=e=>{e.preventDefault();e.stopPropagation();try{b.setPointerCapture(e.pointerId)}catch(_){}
   if(!armed||!callbacks)return;
   b.classList.add('pressed');callbacks(key,true);
 };
 const end=e=>{e.preventDefault();e.stopPropagation();b.classList.remove('pressed');if(key==='guard'&&callbacks)callbacks(key,false)};
 b.addEventListener('pointerdown',begin);
 ['pointerup','pointercancel','lostpointercapture'].forEach(t=>b.addEventListener(t,end));
 b.addEventListener('contextmenu',e=>e.preventDefault());
 return b;
}
function mount(){
 if(root)return root;
 root=document.createElement('div');root.id='sin-review-actions';root.setAttribute('role','group');root.setAttribute('aria-label','أزرار تحكم سين');
 ['guard','axe','heavy','dodge','light','interact'].forEach(k=>root.appendChild(makeButton(k)));
 document.body.appendChild(root);
 return root;
}
window.SinReviewHud={
  mount,
  connect(fn){mount();callbacks=fn;},
  enable(v){armed=!!v; mount().classList.toggle('enabled',armed);if(!armed&&callbacks)callbacks('guard',false);},
  setState({weapon='BACK',interact=false,combat=true}={}){
    mount();
    root.dataset.weapon=weapon;
    root.querySelector('[data-action="interact"]').classList.toggle('available',!!interact);
    for(const k of ['light','heavy','guard','dodge','axe'])root.querySelector('[data-action="'+k+'"]').disabled=!combat;
  }
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();