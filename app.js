const DB_URL='./databaze.json';
let database=[], groupedDb=new Map(), results=[], activeFilter='all', dbLimit=100;
let invoiceCosts=new Map(), invoiceCostMeta={recognized:false,assigned:0};
let activeCostFilter='all';
const $=id=>document.getElementById(id);
const fmtDate=iso=>{if(!iso)return'';const [y,m,d]=String(iso).split('-');return y&&m&&d?`${d}.${m}.${y}`:String(iso)};
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=value=>new Intl.NumberFormat('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0))+' €';

function normalizeTextKey(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'').toLowerCase();
}

function parseEuroAmount(raw){
  const cleaned=String(raw||'').replace(/\s+/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const n=Number(cleaned);
  return Number.isFinite(n)?n:null;
}

function contentToVisualLines(content){
  const items=(content.items||[]).filter(i=>String(i.str||'').trim()).map(i=>({
    text:String(i.str||'').trim(),
    x:Number(i.transform?.[4]||0),
    y:Number(i.transform?.[5]||0)
  })).sort((a,b)=>Math.abs(b.y-a.y)>2.2?b.y-a.y:a.x-b.x);
  const lines=[];
  for(const item of items){
    let line=lines[lines.length-1];
    if(!line || Math.abs(line.y-item.y)>2.2){
      line={y:item.y,items:[]};
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines.map(line=>line.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '));
}

function extractInvoiceCostsFromVisualLines(pageLineSets){
  const costs=new Map();
  let currentPhone=null;
  let recognized=false;
  for(const page of pageLineSets){
    for(const line of page.lines){
      const phoneMatch=line.match(/(?:^|\D)(421(?:\s*\d){9})(?!\d)/);
      if(phoneMatch){
        const normalized=normalizeCandidate(phoneMatch[1]);
        if(normalized) currentPhone=normalized;
      }
      if(!currentPhone) continue;
      const key=normalizeTextKey(line);
      if(key.includes('poplatkyspolu:')){
        // O2 PDF často rozděluje desetinné číslice mezerami, např.
        // "7,680 0 €" nebo "10 ,830 0 €". Povolit proto mezery
        // uvnitř celé číselné hodnoty a následně je odstranit v parseEuroAmount().
        const amounts=[...line.matchAll(/(-?(?:\d[\d\s.]*?)\s*,\s*(?:\d\s*){2,4})\s*€/g)];
        if(amounts.length){
          const amount=parseEuroAmount(amounts[amounts.length-1][1]);
          if(amount!==null){
            costs.set(currentPhone,(costs.get(currentPhone)||0)+amount);
            recognized=true;
          }
        }
      }
    }
  }
  return {costs,recognized};
}


function parseIsoDate(s){
  if(!s) return null;
  const parts=String(s).split('-').map(Number);
  if(parts.length!==3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(parts[0],parts[1]-1,parts[2]);
}

function oneYearAgoToday(){
  const d=new Date();
  d.setFullYear(d.getFullYear()-1);
  return d;
}

function uniquePhonesWhere(records,predicate){
  return new Set(records.filter(predicate).map(r=>r.phone).filter(Boolean)).size;
}

function updateDatabaseKpis(){
  const cutoff=oneYearAgoToday();
  const oldActive=uniquePhonesWhere(database,r=>{
    const dt=parseIsoDate(r.lastCheck);
    return r.ownerStatus==='Aktivní' && dt && dt<cutoff;
  });
  const terminated=uniquePhonesWhere(database,r=>String(r.ownerStatus||'').startsWith('Ukončený'));
  $('kpiOldActive').textContent=oldActive.toLocaleString('cs-CZ');
  $('kpiTerminated').textContent=terminated.toLocaleString('cs-CZ');
}

function updateInvoiceKpi(){
  const phones=new Set(results.filter(r=>r.matched && String(r.status||'').trim().toLowerCase()!=='vlastněno').map(r=>r.phone).filter(Boolean));
  $('kpiInvoiceNotOwned').textContent=phones.size.toLocaleString('cs-CZ');
  $('kpiInvoiceNote').textContent=results.length ? 'unikátních čísel z nahrané faktury' : 'nahraj PDF fakturu';
}

async function loadDatabase(){
  try{
    const res=await fetch(DB_URL,{cache:'no-store'});
    if(!res.ok) throw new Error('Databázi se nepodařilo načíst.');
    const data=await res.json();
    database=data.records||[];
    groupedDb=groupByPhone(database);
    $('mDatabase').textContent=database.length.toLocaleString('cs-CZ');
    $('dbState').textContent=`${database.length.toLocaleString('cs-CZ')} záznamů v databázi`;
    document.querySelector('.dot').classList.add('ready');
    renderDatabase();
    updateDatabaseKpis();
  }catch(err){
    $('dbState').textContent='Chyba databáze';
    showMessage(err.message,'error');
  }
}

function groupByPhone(records){
  const map=new Map();
  for(const r of records){
    const p=r.phone||'';
    if(!map.has(p)) map.set(p,[]);
    map.get(p).push(r);
  }
  return map;
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
    const pageLineSets=[];
    let totalText=0;

    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const text=content.items.map(i=>i.str).join(' ');
      const lines=contentToVisualLines(content);
      pageLineSets.push({page:p,lines});
      totalText+=text.trim().length;

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

    const parsedCosts=extractInvoiceCostsFromVisualLines(pageLineSets);
    invoiceCosts=parsedCosts.costs;
    invoiceCostMeta={recognized:parsedCosts.recognized,assigned:invoiceCosts.size};

    results=[];
    for(const [phone,pages] of occurrences.entries()){
      const recs=groupedDb.get(phone)||[];
      if(recs.length===0){
        results.push({phone,pages:[...pages].sort((a,b)=>a-b),matched:false,invoiceCost:invoiceCosts.get(phone)??null});
      }else{
        for(const rec of recs){
          results.push({...rec,phone,pages:[...pages].sort((a,b)=>a-b),matched:true,invoiceCost:invoiceCosts.get(phone)??null});
        }
      }
    }

    results.sort((a,b)=>Number(b.matched)-Number(a.matched)||String(a.phone).localeCompare(String(b.phone)));

    $('mCandidates').textContent=occurrences.size;
    $('mMatched').textContent=results.filter(r=>r.matched).length;
    $('mUnmatched').textContent=results.filter(r=>!r.matched).length;
    $('results').classList.remove('hidden');
    renderResults();
    updateInvoiceKpi();
    prepareAnalysis();
    renderPotentialCosts();

    if(!results.length) showMessage('V PDF jsem nenašla žádné devítimístné kandidátní telefonní číslo.','info');
  }catch(err){
    console.error(err);
    showMessage('PDF se nepodařilo zpracovat. Pošli mi vzorek faktury a upravíme detekci pro konkrétní formát.','error');
  }finally{
    setTimeout(()=>{$('progress').classList.add('hidden');$('progressBar').style.width='0';},350);
  }
}

function renderResults(){
  const q=$('resultSearch').value.trim().toLowerCase();
  const rows=results.filter(r=>activeFilter==='all'||(activeFilter==='matched')===r.matched).filter(r=>{
    const hay=[r.phone,r.country,r.department,r.owner,r.ownerId,r.ownerStatus,r.assetCard,r.status,r.name,(r.pages||[]).join(',')].join(' ').toLowerCase();
    return !q||hay.includes(q);
  });

  $('resultBody').innerHTML=rows.map(r=>`
    <tr>
      <td><span class="status-pill ${r.matched?'ok':'miss'}">${r.matched?'✓ Nalezeno':'! Nenalezeno'}</span></td>
      <td><strong>${esc(r.phone)}</strong></td>
      <td>${esc(r.country||'')}</td>
      <td>${esc(r.department||'')}</td>
      <td>${esc(r.owner||'')}</td>
      <td>${esc(r.ownerId||'')}</td>
      <td>${esc(r.ownerStatus||'')}</td>
      <td>${esc(r.assetCard||'')}</td>
      <td>${esc(r.status||'')}</td>
      <td>${esc(r.name||'')}</td>
      <td>${esc(fmtDate(r.lastCheck||''))}</td>
      <td>${r.invoiceCost===null?'—':esc(money(r.invoiceCost))}</td>
      <td>${esc((r.pages||[]).join(', '))}</td>
    </tr>`).join('');

  $('emptyResult').classList.toggle('hidden',rows.length>0);
}

function renderDatabase(){
  const q=$('dbSearch').value.trim().toLowerCase();
  const filtered=database.filter(r=>{
    const hay=[r.phone,r.country,r.department,r.owner,r.ownerId,r.ownerStatus,r.assetCard,r.status,r.name,r.lastCheck].join(' ').toLowerCase();
    return !q||hay.includes(q);
  });

  const shown=filtered.slice(0,dbLimit);
  $('dbBody').innerHTML=shown.map(r=>`
    <tr>
      <td><strong>${esc(r.phone||'')}</strong></td>
      <td>${esc(r.country||'')}</td>
      <td>${esc(r.department||'')}</td>
      <td>${esc(r.owner||'')}</td>
      <td>${esc(r.ownerId||'')}</td>
      <td>${esc(r.ownerStatus||'')}</td>
      <td>${esc(r.assetCard||'')}</td>
      <td>${esc(r.status||'')}</td>
      <td>${esc(r.name||'')}</td>
      <td>${esc(fmtDate(r.lastCheck||''))}</td>
    </tr>`).join('');

  $('dbEmpty').classList.toggle('hidden',filtered.length>0);
  $('dbCount').textContent=`Zobrazeno ${shown.length} z ${filtered.length.toLocaleString('cs-CZ')}`;
  $('showMore').classList.toggle('hidden',shown.length>=filtered.length);
}


const ANALYSIS_FIELDS=[
  {key:'phone',label:'Telefon'},
  {key:'country',label:'Země'},
  {key:'department',label:'Oddělení'},
  {key:'owner',label:'Vlastník'},
  {key:'ownerId',label:'Vlastník (id)'},
  {key:'ownerStatus',label:'Stav vlastníka'},
  {key:'assetCard',label:'Majetková karta'},
  {key:'status',label:'Stav SIM'},
  {key:'name',label:'Název'},
  {key:'lastCheck',label:'Poslední kontrola'}
];

let analysisFilters=[];
let nextAnalysisFilterId=1;

function fieldLabel(key){
  const f=ANALYSIS_FIELDS.find(x=>x.key===key);
  return f?f.label:key;
}

function displayFieldValue(key,value){
  if(key==='lastCheck') return fmtDate(value);
  return String(value??'');
}

function uniqueValues(records,key){
  const vals=[...new Set(records.map(r=>String(r[key]||'').trim()).filter(Boolean))];
  if(key==='lastCheck') return vals.sort((a,b)=>String(b).localeCompare(String(a)));
  return vals.sort((a,b)=>a.localeCompare(b,'cs',{numeric:true,sensitivity:'base'}));
}

function populateGroupBy(){
  const el=$('analysisGroupBy');
  const current=el.value||'department';
  el.innerHTML=ANALYSIS_FIELDS.map(f=>`<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('');
  el.value=ANALYSIS_FIELDS.some(f=>f.key===current)?current:'department';
}

function createAnalysisFilter(initialField='department',initialValue=''){
  analysisFilters.push({id:nextAnalysisFilterId++,field:initialField,value:initialValue});
  renderAnalysisFilterRows();
}

function renderAnalysisFilterRows(){
  const wrap=$('analysisFilterRows');
  if(!analysisFilters.length){
    wrap.innerHTML='<div class="empty">Není nastaven žádný filtr. Analýza zobrazuje celou fakturu.</div>';
    return;
  }
  wrap.innerHTML=analysisFilters.map(f=>{
    const values=uniqueValues(database,f.field);
    const fieldOptions=ANALYSIS_FIELDS.map(x=>`<option value="${esc(x.key)}" ${x.key===f.field?'selected':''}>${esc(x.label)}</option>`).join('');
    const valueOptions=['<option value="">Všechny hodnoty</option>',...values.map(v=>`<option value="${esc(v)}" ${v===f.value?'selected':''}>${esc(displayFieldValue(f.field,v))}</option>`)].join('');
    return `<div class="analysis-filter-row" data-filter-id="${f.id}">
      <label><span>Kategorie</span><select class="analysis-field-select">${fieldOptions}</select></label>
      <label><span>Hodnota</span><select class="analysis-value-select">${valueOptions}</select></label>
      <button class="ghost-btn remove-analysis-filter" type="button">Odebrat</button>
    </div>`;
  }).join('');

  for(const row of wrap.querySelectorAll('.analysis-filter-row')){
    const id=Number(row.dataset.filterId);
    row.querySelector('.analysis-field-select').addEventListener('change',e=>{
      const f=analysisFilters.find(x=>x.id===id);
      if(!f) return;
      f.field=e.target.value;
      f.value='';
      renderAnalysisFilterRows();
      renderAnalysis();
    });
    row.querySelector('.analysis-value-select').addEventListener('change',e=>{
      const f=analysisFilters.find(x=>x.id===id);
      if(!f) return;
      f.value=e.target.value;
      renderAnalysis();
    });
    row.querySelector('.remove-analysis-filter').addEventListener('click',()=>{
      analysisFilters=analysisFilters.filter(x=>x.id!==id);
      renderAnalysisFilterRows();
      renderAnalysis();
    });
  }
}

function invoiceAnalysisRecords(){
  return results.filter(r=>r.matched);
}

function filteredAnalysisRows(){
  return invoiceAnalysisRecords().filter(r=>analysisFilters.every(f=>{
    if(!f.value) return true;
    return String(r[f.field]||'').trim()===f.value;
  }));
}

function uniquePhoneCount(rows,predicate=()=>true){
  return new Set(rows.filter(predicate).map(r=>r.phone).filter(Boolean)).size;
}

function isOwned(r){return String(r.status||'').trim().toLowerCase()==='vlastněno';}
function isTerminatedOwner(r){return String(r.ownerStatus||'').startsWith('Ukončený');}

function renderStatusBreakdown(rows){
  const statuses=new Map();
  for(const r of rows){
    const name=String(r.status||'Bez stavu').trim()||'Bez stavu';
    if(!statuses.has(name)) statuses.set(name,new Set());
    if(r.phone) statuses.get(name).add(r.phone);
  }
  const total=uniquePhoneCount(rows);
  const ordered=[...statuses.entries()].map(([name,set])=>({name,count:set.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'cs'));
  $('statusBreakdown').innerHTML=ordered.length?ordered.map(x=>{
    const pct=total?Math.round(x.count/total*100):0;
    return `<div class="status-row"><div class="status-row-head"><strong>${esc(x.name)}</strong><span>${x.count.toLocaleString('cs-CZ')} · ${pct}%</span></div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
  }).join(''):'<div class="empty">Pro zvolené filtry nejsou žádná data.</div>';
}

function renderAnalysis(){
  const hasInvoice=results.length>0;
  $('analysisEmpty').classList.toggle('hidden',hasInvoice);
  $('analysisContent').classList.toggle('hidden',!hasInvoice);
  if(!hasInvoice) return;

  const rows=filteredAnalysisRows();
  $('aTotal').textContent=uniquePhoneCount(rows).toLocaleString('cs-CZ');
  $('aOwned').textContent=uniquePhoneCount(rows,isOwned).toLocaleString('cs-CZ');
  $('aNotOwned').textContent=uniquePhoneCount(rows,r=>!isOwned(r)).toLocaleString('cs-CZ');
  $('aTerminated').textContent=uniquePhoneCount(rows,isTerminatedOwner).toLocaleString('cs-CZ');

  const groupKey=$('analysisGroupBy').value||'department';
  const label=fieldLabel(groupKey);
  $('pivotTitle').textContent=`Rozpad podle: ${label.toLowerCase()}`;
  $('groupHeader').textContent=label;

  const groups=new Map();
  for(const r of rows){
    const raw=String(r[groupKey]||'').trim();
    const k=raw||'Neuvedeno';
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  const pivot=[...groups.entries()].map(([name,items])=>({
    name:displayFieldValue(groupKey,name),
    total:uniquePhoneCount(items),
    owned:uniquePhoneCount(items,isOwned),
    notOwned:uniquePhoneCount(items,r=>!isOwned(r)),
    terminated:uniquePhoneCount(items,isTerminatedOwner)
  })).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'cs',{numeric:true}));

  $('pivotBody').innerHTML=pivot.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.total.toLocaleString('cs-CZ')}</td><td>${x.owned.toLocaleString('cs-CZ')}</td><td>${x.notOwned.toLocaleString('cs-CZ')}</td><td>${x.terminated.toLocaleString('cs-CZ')}</td></tr>`).join('');
  $('pivotEmpty').classList.toggle('hidden',pivot.length>0);
  renderStatusBreakdown(rows);
}

function prepareAnalysis(){
  populateGroupBy();
  if(!analysisFilters.length) createAnalysisFilter('department','');
  else renderAnalysisFilterRows();
  renderAnalysis();
}


function isInactiveOwnerCost(r){
  return String(r.ownerStatus||'').startsWith('Ukončený');
}
function isRetiredSimCost(r){
  return String(r.status||'').trim().toLowerCase()==='vyřazeno';
}
function costReason(r){
  const inactive=isInactiveOwnerCost(r), retired=isRetiredSimCost(r);
  if(inactive&&retired) return 'Ukončený vlastník + SIM Vyřazeno';
  if(inactive) return 'Ukončený vlastník';
  if(retired) return 'SIM Vyřazeno';
  return '';
}
function potentialCostRows(){
  const byPhone=new Map();
  for(const r of results.filter(x=>x.matched && (isInactiveOwnerCost(x)||isRetiredSimCost(x)))){
    if(!byPhone.has(r.phone)) byPhone.set(r.phone,r);
    else {
      const existing=byPhone.get(r.phone);
      if(existing.invoiceCost===null && r.invoiceCost!==null) byPhone.set(r.phone,r);
    }
  }
  return [...byPhone.values()];
}
function renderPotentialCosts(){
  const hasInvoice=results.length>0;
  $('costsEmpty').classList.toggle('hidden',hasInvoice);
  $('costsContent').classList.toggle('hidden',!hasInvoice);
  if(!hasInvoice) return;

  const all=potentialCostRows();
  const inactivePhones=new Set(all.filter(isInactiveOwnerCost).map(r=>r.phone));
  const retiredPhones=new Set(all.filter(isRetiredSimCost).map(r=>r.phone));
  const knownCostRows=all.filter(r=>r.invoiceCost!==null && Number.isFinite(Number(r.invoiceCost)));
  const monthly=knownCostRows.reduce((sum,r)=>sum+Number(r.invoiceCost||0),0);

  $('cMonthly').textContent=money(monthly);
  $('cAnnual').textContent=money(monthly*12);
  $('cInactiveOwner').textContent=inactivePhones.size.toLocaleString('cs-CZ');
  $('cRetiredSim').textContent=retiredPhones.size.toLocaleString('cs-CZ');
  $('cFlagged').textContent=all.length.toLocaleString('cs-CZ');

  $('costParserState').textContent=invoiceCostMeta.recognized?`Rozpoznáno ${invoiceCostMeta.assigned} částek za čísla`:'Rozpis částek nebyl rozpoznán';
  $('costParserState').classList.toggle('ok',invoiceCostMeta.recognized);

  const missing=all.filter(r=>r.invoiceCost===null).length;
  const warning=$('costWarning');
  if(!invoiceCostMeta.recognized){
    warning.textContent='U této faktury se nepodařilo automaticky rozpoznat částky „Poplatky spolu“ u jednotlivých čísel. Riziková čísla jsou označena, ale finanční součet není úplný.';
    warning.classList.remove('hidden');
  }else if(missing){
    warning.textContent=`U ${missing} rizikových čísel se nepodařilo přiřadit částku. Finanční součet proto zahrnuje pouze čísla s rozpoznaným nákladem.`;
    warning.classList.remove('hidden');
  }else{
    warning.classList.add('hidden');
  }

  const q=$('costSearch').value.trim().toLowerCase();
  const filtered=all.filter(r=>{
    const inactive=isInactiveOwnerCost(r), retired=isRetiredSimCost(r);
    if(activeCostFilter==='inactive'&&!inactive) return false;
    if(activeCostFilter==='retired'&&!retired) return false;
    if(activeCostFilter==='both'&&!(inactive&&retired)) return false;
    const hay=[r.phone,r.owner,r.ownerStatus,r.status,r.department,r.assetCard,costReason(r)].join(' ').toLowerCase();
    return !q||hay.includes(q);
  }).sort((a,b)=>(Number(b.invoiceCost||0)-Number(a.invoiceCost||0))||String(a.phone).localeCompare(String(b.phone)));

  $('costBody').innerHTML=filtered.map(r=>`<tr>
    <td><strong>${esc(r.phone)}</strong></td>
    <td>${esc(r.owner||'')}</td>
    <td>${esc(r.ownerStatus||'')}</td>
    <td>${esc(r.status||'')}</td>
    <td>${esc(r.department||'')}</td>
    <td><strong>${r.invoiceCost===null?'—':esc(money(r.invoiceCost))}</strong></td>
    <td><span class="risk-reason">${esc(costReason(r))}</span></td>
    <td>${esc((r.pages||[]).join(', '))}</td>
  </tr>`).join('');
  $('costEmptyRows').classList.toggle('hidden',filtered.length>0);
}

function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}

function exportCsv(){
  const header=['Výsledek','Telefon','Země','Oddělení','Vlastník','Vlastník (id)','Stav vlastníka','Majetková karta','Stav SIM','Název','Poslední kontrola','Náklad bez DPH','Strana PDF'];
  const lines=[header.map(csvCell).join(';')];
  for(const r of results){
    lines.push([
      r.matched?'Nalezeno':'Nenalezeno',r.phone,r.country||'',r.department||'',r.owner||'',r.ownerId||'',r.ownerStatus||'',r.assetCard||'',r.status||'',r.name||'',fmtDate(r.lastCheck||''),r.invoiceCost===null?'':r.invoiceCost,(r.pages||[]).join(', ')
    ].map(csvCell).join(';'));
  }
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='kontrola_telefonu.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function showMessage(text,type='info'){$('message').textContent=text;$('message').className=`message ${type}`;}
function clearMessage(){$('message').className='message hidden';$('message').textContent='';}
function setFile(file){
  if(!file) return;
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){showMessage('Vyber prosím PDF soubor.','error');return;}
  $('fileName').textContent=file.name;
  $('fileMeta').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;
  $('fileRow').classList.remove('hidden');
  processPdf(file);
}

for(const btn of document.querySelectorAll('.tab')){btn.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));$('invoiceTab').classList.toggle('active',btn.dataset.tab==='invoice');$('databaseTab').classList.toggle('active',btn.dataset.tab==='database');$('analysisTab').classList.toggle('active',btn.dataset.tab==='analysis');$('costsTab').classList.toggle('active',btn.dataset.tab==='costs');if(btn.dataset.tab==='analysis') renderAnalysis();if(btn.dataset.tab==='costs') renderPotentialCosts();});}
for(const btn of document.querySelectorAll('.filter')){btn.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===btn));activeFilter=btn.dataset.filter;renderResults();});}
const dz=$('dropzone'), inp=$('pdfInput');
dz.addEventListener('click',()=>inp.click());
dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ') inp.click();});
inp.addEventListener('change',()=>setFile(inp.files[0]));
for(const ev of ['dragenter','dragover']){dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');});}
for(const ev of ['dragleave','drop']){dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');});}
dz.addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));
$('removeFile').addEventListener('click',()=>{inp.value='';$('fileRow').classList.add('hidden');$('results').classList.add('hidden');results=[];invoiceCosts=new Map();invoiceCostMeta={recognized:false,assigned:0};$('kpiInvoiceNotOwned').textContent='—';$('kpiInvoiceNote').textContent='nahraj PDF fakturu';renderAnalysis();renderPotentialCosts();clearMessage();});
$('resultSearch').addEventListener('input',renderResults);
$('exportCsv').addEventListener('click',exportCsv);
$('dbSearch').addEventListener('input',()=>{dbLimit=100;renderDatabase();});
$('showMore').addEventListener('click',()=>{dbLimit+=100;renderDatabase();});
$('analysisGroupBy').addEventListener('change',renderAnalysis);
$('addAnalysisFilter').addEventListener('click',()=>createAnalysisFilter('department',''));
$('resetAnalysis').addEventListener('click',()=>{analysisFilters=[];nextAnalysisFilterId=1;createAnalysisFilter('department','');$('analysisGroupBy').value='department';renderAnalysis();});
for(const btn of document.querySelectorAll('.cost-filter')){btn.addEventListener('click',()=>{document.querySelectorAll('.cost-filter').forEach(b=>b.classList.toggle('active',b===btn));activeCostFilter=btn.dataset.costFilter;renderPotentialCosts();});}
$('costSearch').addEventListener('input',renderPotentialCosts);
loadDatabase();
