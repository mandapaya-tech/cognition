'use strict';
(()=>{const root=document.getElementById('catalogo-repuestos');if(!root)return;
const $=s=>root.querySelector(s),q=$('#rp-q'),fl=$('#rp-line'),fc=$('#rp-cat'),list=$('#rp-list'),count=$('#rp-count'),cartEl=$('#rp-cart');
const money=n=>'US$ '+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const wa=i=>'https://wa.me/17543006570?text='+encodeURIComponent(`Hola, quiero consultar el precio del repuesto: ${i.name}${i.pn?' (P/N '+i.pn+')':''} – ${i.line}.`);
const KEY='cognition-carrito';let data=[],byId=new Map(),cart={};
try{cart=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch{cart={}}
const params=new URLSearchParams(location.search);
if(params.get('compra')==='ok'){cart={};}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(cart))}catch{}};
const opts=(sel,vals,all)=>{sel.innerHTML=`<option value="">${all}</option>`+vals.map(v=>`<option>${esc(v)}</option>`).join('')};
function render(){const t=q.value.trim().toLowerCase(),l=fl.value,c=fc.value;
 const r=data.filter(i=>(!l||i.line===l)&&(!c||i.category===c)&&(!t||(i.name+' '+(i.pn||'')+' '+i.category).toLowerCase().includes(t)));
 count.textContent=`${r.length} repuesto${r.length===1?'':'s'}`;
 const groups={};r.forEach(i=>{(groups[i.line+' · '+i.category]??=[]).push(i)});
 list.innerHTML=Object.entries(groups).map(([g,items])=>`<h3 class="rp-group">${esc(g)}</h3><div class="rp-grid">`+items.map(i=>`<article class="rp-card"><strong>${esc(i.name)}</strong><span class="rp-pn">${i.digital?esc(i.desc||'Producto digital'):i.pn?'N.º de parte: '+esc(i.pn):'N.º de parte: a confirmar'}</span><span class="rp-price">${i.price!=null?money(i.price):'Consultar precio'}</span>${i.price!=null?`<button type="button" class="button small" data-add="${esc(i.id)}">${cart[i.id]?'En el carrito ('+cart[i.id]+')':'Agregar al carrito'}</button>`:`<a class="button small rp-alt" href="${wa(i)}" target="_blank" rel="noopener noreferrer">Consultar precio</a>`}</article>`).join('')+'</div>').join('')||'<p>No encontramos repuestos con ese filtro.</p>';}
function renderCart(msg){const ids=Object.keys(cart).filter(id=>byId.has(id));
 if(!ids.length){cartEl.innerHTML=`<h3>Tu carrito</h3><p class="rp-empty">${msg||'Aún no has agregado repuestos.'}</p>`;return}
 let total=0;const rows=ids.map(id=>{const i=byId.get(id),n=cart[id];total+=i.price*n;return `<li><span>${esc(i.name)}<small>${esc(i.line)}${i.pn?' · '+esc(i.pn):''}</small></span><input type="number" min="1" max="99" value="${n}" data-qty="${esc(id)}" aria-label="Cantidad"/><b>${money(i.price*n)}</b><button type="button" class="rp-x" data-del="${esc(id)}" aria-label="Quitar">×</button></li>`}).join('');
 cartEl.innerHTML=`<h3>Tu carrito</h3><ul>${rows}</ul><p class="rp-total">Subtotal <b>${money(total)}</b></p><p class="note">El impuesto de venta se calcula al pagar.${ids.some(id=>!byId.get(id).digital)?' El costo de envío se calcula y se confirma contigo después de la compra.':' Las gift cards son digitales: no requieren envío.'}</p><button type="button" class="button" id="rp-pay">Pagar con tarjeta</button><p class="rp-msg" role="status">${msg||''}</p>`;}
root.addEventListener('click',async e=>{const a=e.target.closest('[data-add]'),d=e.target.closest('[data-del]');
 if(a){const id=a.dataset.add;cart[id]=Math.min(99,(cart[id]||0)+1);save();render();renderCart();}
 if(d){delete cart[d.dataset.del];save();render();renderCart();}
 if(e.target.id==='rp-pay'){const b=e.target;b.disabled=true;b.textContent='Abriendo pago seguro…';
  try{const r=await fetch('/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:Object.entries(cart).map(([id,qty])=>({id,qty}))})});const j=await r.json();if(r.ok&&j.url){location.href=j.url;return}throw new Error(j.error||'Error')}
  catch(err){b.disabled=false;b.textContent='Pagar con tarjeta';root.querySelector('.rp-msg').textContent=err.message||'No pudimos iniciar el pago.'}}});
root.addEventListener('change',e=>{const t=e.target.closest('[data-qty]');if(!t)return;const n=Math.max(1,Math.min(99,Math.floor(+t.value)||1));cart[t.dataset.qty]=n;save();render();renderCart();});
fetch('repuestos.json').then(r=>r.json()).then(d=>{data=d;byId=new Map(d.filter(i=>i.price!=null).map(i=>[i.id,i]));for(const id of Object.keys(cart))if(!byId.has(id))delete cart[id];save();
 opts(fl,[...new Set(d.map(i=>i.line))],'Todas las líneas');opts(fc,[...new Set(d.map(i=>i.category))].sort(),'Todas las categorías');render();
 renderCart(params.get('compra')==='ok'?'¡Gracias por tu compra! Te contactaremos para confirmar el envío.':params.get('compra')==='cancelada'?'El pago fue cancelado. Tu carrito sigue aquí.':'');})
 .catch(()=>{list.textContent='No pudimos cargar el catálogo. Escríbenos por WhatsApp.'});
[q,fl,fc].forEach(e=>e.addEventListener('input',render));})();
