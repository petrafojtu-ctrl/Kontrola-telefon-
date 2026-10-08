
const DB_URL='./databaze.json';
let database=[], dbMap=new Map(), results=[], activeFilter='all', dbLimit=100;
const $=id=>document.getElementById(id);
const fmtDate=iso=>{if(!iso)return'';const[y,m,d]=iso.split('-');return`${d}.${m}.${y}`};
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadDatabase(){
  try{
    const res=await fetch(DB_URL,{cache:'no-store'});
    if(!res.ok) throw new Error('Databázi se nepodařilo načíst.');
    const data=await res.json();
    database=data.records||[];
    dbMap=new Map(database.map(r=>[r.phone,r]));
    $('mDatabase').textContent=database.length.toLocaleString('cs-CZ');
    $('dbState').textContent=`${database.length.toLocaleString('cs-CZ')} záznamů v databázi`;
    document.querySelector('.dot').classList.add('ready');
    renderDatabase();
  }catch(err){
    $('dbState').textContent='Chyba databáze';
    showMessage(err.message,'error');
  }
}

function normalizeCandidate(raw){
  let d=String(raw).replace(/\D/g,'');
  if(d.startsWith('00420')) d=d.slice(5);
  else if(d.startsWith('00421')) d=d.slice(5);
  else if(d.startsWith('0036')) d=d.slice(4);
  else if(d.length===12 && d.startsWith('420')) d=d.slice(3);
  else if(d.length===12 && d.startsWith('421')) d=d.slice(3);
  else if(d.length===11 && d.startsWith('36')) d=d.slice(2);
  return d.length===9 ? d : null;
}

function extractCandidates(text){
  const re=/(?:\+|00)?(?:420|421|36)?[\s.-]*(?:\d[\s.-]*){9,12}/g;
  const found=[];
  for(const m of text.matchAll(re)){
    const n=normalizeCandidate(m[0]);
    if(n) found.push(n);
  }
  return found;
}

async function ensurePdfJs(){
  const mod=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  return mod;
}

async function processPdf(file){
  clearMessage();
  $('results').classList.add('hidden');
  $('progress').classList.remove('hidden');
  $('progressBar').style.width='4%';

  try{
    const pdfjs=await ensurePdfJs();
    const bytes=new Uint8Array(await file.arrayBuffer());
    const pdf=await pdfjs.getDocument({data:bytes}).promise;
    const occurrences=new Map();
    let totalText=0;

    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const text=content.items.map(i=>i.str).join(' ');
      totalText += text.trim().length;

      for(const phone of extractCandidates(text)){
        if(!occurrences.has(phone)) occurrences.set(phone,new Set());
        occurrences.get(phone).add(p);
      }
      $('progressBar').style.width=`${Math.max(8,Math.round(p/pdf.numPages*100))}%`;
    }

    if(totalText<40){
      showMessage('PDF neobsahuje použitelnou textovou vrstvu. Pravděpodobně jde o sken a bude potřeba doplnit OCR.','error');
      results=[];
      return;
    }

    results=[...occurrences.entries()].map(([phone,pages])=>{
      const rec=dbMap.get(phone);
      return {phone,pages:[...pages].sort((a,b)=>a-b),matched:!!rec,...(rec||{})};
    }).sort((a,b)=>Number(b.matched)-Number(a.matched)||a.phone.localeCompare(b.phone));

    $('mCandidates').textContent=results.length;
    $('mMatched').textContent=results.filter(r=>r.matched).length;
    $('mUnmatched').textContent=results.filter(r=>!r.matched).length;
    $('results').classList.remove('hidden');
    renderResults();

    if(!results.length) showMessage('V PDF jsem nenašla žádné devítimístné kandidátní telefonní číslo.','info');
  }catch(err){
    console.error(err);
    showMessage('PDF se nepodařilo zpracovat. Pošli mi vzorek faktury a upravíme detekci pro konkrétní formát.','error');
  }finally{
    setTimeout(()=>{
      $('progress').classList.add('hidden');
      $('progressBar').style.width='0';
    },350);
  }
}

function renderResults(){
  const q=$('resultSearch').value.trim().toLowerCase();
  const rows=results
    .filter(r=>activeFilter==='all'||(activeFilter==='matched')===r.matched)
    .filter(r=>{
      const hay=[r.phone,r.country,r.department,r.owner,r.assetCard,r.status,r.name,(r.pages||[]).join(',')].join(' ').toLowerCase();
      return !q||hay.includes(q);
    });

  $('resultBody').innerHTML=rows.map(r=>`
    <tr>
      <td><span class="status-pill ${r.matched?'ok':'miss'}">${r.matched?'✓ Nalezeno':'! Nenalezeno'}</span></td>
      <td><strong>${esc(r.phone)}</strong></td>
      <td>${esc(r.country||'')}</td>
      <td>${esc(r.department||'')}</td>
      <td>${esc(r.owner||'')}</td>
      <td>${esc(r.assetCard||'')}</td>
      <td>${esc(r.status||'')}</td>
      <td>${esc(r.name||'')}</td>
      <td>${esc(fmtDate(r.lastCheck||''))}</td>
      <td>${esc((r.pages||[]).join(', '))}</td>
    </tr>
  `).join('');

  $('emptyResult').classList.toggle('hidden',rows.length>0);
}

function renderDatabase(){
  const q=$('dbSearch').value.trim().toLowerCase();
  const filtered=database.filter(r=>{
    const hay=[r.phone,r.country,r.department,r.owner,r.assetCard,r.status,r.name,r.lastCheck].join(' ').toLowerCase();
    return !q||hay.includes(q);
  });

  const shown=filtered.slice(0,dbLimit);
  $('dbBody').innerHTML=shown.map(r=>`
    <tr>
      <td><strong>${esc(r.phone)}</strong></td>
      <td>${esc(r.country)}</td>
      <td>${esc(r.department)}</td>
      <td>${esc(r.owner)}</td>
      <td>${esc(r.assetCard)}</td>
      <td>${esc(r.status)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(fmtDate(r.lastCheck))}</td>
    </tr>
  `).join('');

  $('dbEmpty').classList.toggle('hidden',filtered.length>0);
  $('dbCount').textContent=`Zobrazeno ${shown.length} z ${filtered.length.toLocaleString('cs-CZ')}`;
  $('showMore').classList.toggle('hidden',shown.length>=filtered.length);
}

function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}

function exportCsv(){
  const header=['Výsledek','Telefon','Země','Oddělení','Vlastník','Majetková karta','Stav','Název','Poslední kontrola','Strana PDF'];
  const lines=[header.map(csvCell).join(';')];

  for(const r of results){
    lines.push([
      r.matched?'Nalezeno':'Nenalezeno',
      r.phone,
      r.country||'',
      r.department||'',
      r.owner||'',
      r.assetCard||'',
      r.status||'',
      r.name||'',
      fmtDate(r.lastCheck||''),
      (r.pages||[]).join(', ')
    ].map(csvCell).join(';'));
  }

  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='kontrola_telefonu.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function showMessage(text,type='info'){
  $('message').textContent=text;
  $('message').className=`message ${type}`;
}
function clearMessage(){
  $('message').className='message hidden';
  $('message').textContent='';
}
function setFile(file){
  if(!file) return;
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){
    showMessage('Vyber prosím PDF soubor.','error');
    return;
  }
  $('fileName').textContent=file.name;
  $('fileMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;
  $('fileRow').classList.remove('hidden');
  processPdf(file);
}

for(const btn of document.querySelectorAll('.tab')){
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
    $('invoiceTab').classList.toggle('active',btn.dataset.tab==='invoice');
    $('databaseTab').classList.toggle('active',btn.dataset.tab==='database');
  });
}

for(const btn of document.querySelectorAll('.filter')){
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===btn));
    activeFilter=btn.dataset.filter;
    renderResults();
  });
}

const dz=$('dropzone');
const inp=$('pdfInput');

dz.addEventListener('click',()=>inp.click());
dz.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' ') inp.click();
});
inp.addEventListener('change',()=>setFile(inp.files[0]));

for(const ev of ['dragenter','dragover']){
  dz.addEventListener(ev,e=>{
    e.preventDefault();
    dz.classList.add('dragover');
  });
}
for(const ev of ['dragleave','drop']){
  dz.addEventListener(ev,e=>{
    e.preventDefault();
    dz.classList.remove('dragover');
  });
}
dz.addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));

$('removeFile').addEventListener('click',()=>{
  inp.value='';
  $('fileRow').classList.add('hidden');
  $('results').classList.add('hidden');
  results=[];
  clearMessage();
});

$('resultSearch').addEventListener('input',renderResults);
$('exportCsv').addEventListener('click',exportCsv);
$('dbSearch').addEventListener('input',()=>{
  dbLimit=100;
  renderDatabase();
});
$('showMore').addEventListener('click',()=>{
  dbLimit+=100;
  renderDatabase();
});

loadDatabase();
