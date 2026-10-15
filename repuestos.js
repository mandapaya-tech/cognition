'use strict';
(()=>{const root=document.getElementById('catalogo-repuestos');if(!root)return;
const $=s=>root.querySelector(s),q=$('#rp-q'),fl=$('#rp-line'),fc=$('#rp-cat'),list=$('#rp-list'),count=$('#rp-count');
const money=n=>'US$ '+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const wa=i=>'https://wa.me/17543006570?text='+encodeURIComponent(`Hola, quiero el repuesto: ${i.name}${i.pn?' (P/N '+i.pn+')':''} – ${i.line}.`);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let data=[];
const opts=(sel,vals,all)=>{sel.innerHTML=`<option value="">${all}</option>`+vals.map(v=>`<option>${esc(v)}</option>`).join('')};
function render(){const t=q.value.trim().toLowerCase(),l=fl.value,c=fc.value;
 const r=data.filter(i=>(!l||i.line===l)&&(!c||i.category===c)&&(!t||(i.name+' '+(i.pn||'')+' '+i.category).toLowerCase().includes(t)));
 count.textContent=`${r.length} repuesto${r.length===1?'':'s'}`;
 const groups={};r.forEach(i=>{(groups[i.line+' · '+i.category]??=[]).push(i)});
 list.innerHTML=Object.entries(groups).map(([g,items])=>`<h3 class="rp-group">${esc(g)}</h3><div class="rp-grid">`+items.map(i=>`<article class="rp-card"><strong>${esc(i.name)}</strong><span class="rp-pn">${i.pn?'N.º de parte: '+esc(i.pn):'N.º de parte: a confirmar'}</span><span class="rp-price">${i.price!=null?money(i.price):'Consultar precio'}</span>${i.url?`<a class="button small" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Comprar</a>`:`<a class="button small rp-alt" href="${wa(i)}" target="_blank" rel="noopener noreferrer">${i.price!=null?'Pedir por WhatsApp':'Consultar precio'}</a>`}</article>`).join('')+'</div>').join('')||'<p>No encontramos repuestos con ese filtro.</p>';}
fetch('repuestos.json').then(r=>r.json()).then(d=>{data=d;opts(fl,[...new Set(d.map(i=>i.line))],'Todas las líneas');opts(fc,[...new Set(d.map(i=>i.category))].sort(),'Todas las categorías');render()}).catch(()=>{list.textContent='No pudimos cargar el catálogo. Escríbenos por WhatsApp.'});
[q,fl,fc].forEach(e=>e.addEventListener('input',render));})();
