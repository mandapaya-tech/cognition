"use strict";
const elements=[...document.querySelectorAll('[data-en]')];
elements.forEach(e=>{e.dataset.es=e.textContent;});
let language=new URLSearchParams(location.search).get('lang')==='en'?'en':'es';
const toggle=document.getElementById('legal-language');
function setLanguage(){document.documentElement.lang=language;elements.forEach(e=>{e.textContent=e.dataset[language];});toggle.textContent=language==='es'?'EN':'ES';toggle.setAttribute('aria-label',language==='es'?'Switch to English':'Cambiar a español');document.title=document.querySelector('h1').textContent+' | Cognition Industries';document.querySelectorAll('[data-legal-link]').forEach(a=>{const url=new URL(a.getAttribute('href'),location.href);url.search=language==='en'?'?lang=en':'';a.href=url.href;});document.querySelector('aside nav').setAttribute('aria-label',language==='es'?'Índice del documento':'Document contents');}
toggle.addEventListener('click',()=>{language=language==='es'?'en':'es';const url=new URL(location.href);if(language==='en')url.searchParams.set('lang','en');else url.searchParams.delete('lang');history.replaceState(null,'',url);setLanguage();});setLanguage();
