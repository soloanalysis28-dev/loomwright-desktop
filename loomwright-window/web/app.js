import './vendor/mammoth/mammoth.browser.min.js';
import DOMPurify from './vendor/dompurify/purify.es.mjs';
import { unzipSync } from './vendor/fflate/browser.js';
import * as pdfjsLib from './vendor/pdfjs/build/pdf.min.mjs';
import { WRITING_DEFAULTS, BUNDLED_FONTS, normalizeWritingSettings } from './writing-settings.mjs';
import { smartenInput } from './smart-typography.mjs';
import { recognizeCharacters, getCharacterRecognitionConfig, SENSITIVITY_THRESHOLDS } from './character-recognition.mjs';
const mammoth=window.mammoth;
window.pdfjsLib=pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/build/pdf.worker.min.mjs',import.meta.url).href;
const PDF_CMAP_URL=new URL('./vendor/pdfjs/cmaps/',import.meta.url).href;
const PDF_STANDARD_FONT_URL=new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href;
const APP_VERSION='1.5.0.16';
const PROJECT_RECORD_VERSION=3;
const DEFAULT_STATE={sections:[{id:1,title:'Chapter 1',html:'<p></p>'}],activeId:1,charNotes:{},charProfiles:{},charConfirmed:{},charReviewResolved:{},charStatus:{},finaliseChecklist:{},charIgnore:{},charMerge:{},webPositions:{},webNodes:[],webLinks:[],templates:[]};
const PROJECTS_STORAGE_KEY='loomwright_projects_v1',ACTIVE_PROJECT_KEY='loomwright_active_project_v1',APP_SETTINGS_KEY='loomwright_app_settings_v1',DELETED_PROJECTS_STORAGE_KEY='loomwright_deleted_projects_v1';
const ONLINE_SYNC_ENABLED=false; // Reserved for a later, explicit online-save feature; offline mode is the only active storage.
const DEFAULT_BOOK={title:'',subtitle:'',author:'',coverStyle:'botanical',trim:'trade',font:'serif',dedication:'',includeToc:true,includeCopyright:true};
const CHARACTER_STATUSES=[['unknown','Unknown'],['alive','Alive'],['dead','Dead'],['injured','Injured'],['missing','Missing'],['presumed-dead','Presumed dead'],['captured','Captured'],['recovering','Recovering']];
const SAFE_RICH_TAGS=['p','br','div','span','strong','b','em','i','u','s','strike','sub','sup','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','font'];
const SAFE_RICH_ATTRS=['style','title','color','face','size','dir'];
const SAFE_STYLE_PROPS=['font-family','font-size','font-weight','font-style','text-decoration','text-align','color','background-color','line-height','vertical-align'];
function sanitizeInlineStyle(value){const source=document.createElement('span');source.style.cssText=String(value||'');const target=document.createElement('span');for(const prop of SAFE_STYLE_PROPS){const v=source.style.getPropertyValue(prop).trim();if(v&&v.length<160&&!/(?:url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding)/i.test(v)&&!/[<>;]/.test(v))target.style.setProperty(prop,v)}return target.getAttribute('style')||''}
DOMPurify.addHook('uponSanitizeAttribute',(_node,data)=>{if(data.attrName==='style'){data.attrValue=sanitizeInlineStyle(data.attrValue);if(!data.attrValue)data.keepAttr=false}});
function sanitizeRichHtml(value){try{return DOMPurify.sanitize(String(value??''),{ALLOWED_TAGS:SAFE_RICH_TAGS,ALLOWED_ATTR:SAFE_RICH_ATTRS,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,RETURN_TRUSTED_TYPE:false,FORBID_TAGS:['script','style','iframe','object','embed','svg','math','video','audio','form','input','button'],FORBID_ATTR:['src','srcset','href','xlink:href','action','formaction']})}catch(_){return escapeHtml(value)}}
const MAX_IMPORT_BYTES=20*1024*1024;
const MAX_PROJECT_TEMPLATES=40,MAX_TEMPLATE_HTML_CHARS=2000000;
function setImportSafetyStatus(message,state='ok'){const el=document.getElementById('import-safety-status');if(el){el.textContent=message;el.dataset.state=state}}
function asciiFromBytes(bytes){return new TextDecoder('latin1').decode(bytes)}
async function screenImportFile(file){
  const ext=(file.name.match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase();
  if(!['txt','docx','pdf'].includes(ext))throw new Error('Only .txt, .docx and .pdf files are accepted.');
  if(!file.size||file.size>MAX_IMPORT_BYTES)throw new Error('Choose a non-empty file smaller than 20 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),notes=[];
  if(ext==='txt'){
    if(bytes.subarray(0,Math.min(bytes.length,4096)).includes(0))throw new Error('This does not look like a plain-text file.');
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(_){throw new Error('This text file is not valid UTF-8. Save it as UTF-8 and try again.')}
    return {ext,bytes,notes};
  }
  if(ext==='pdf'){
    const head=asciiFromBytes(bytes.subarray(0,Math.min(bytes.length,1024)));
    if(!head.includes('%PDF-'))throw new Error('This file does not have a PDF signature.');
    const headSample=asciiFromBytes(bytes.subarray(0,Math.min(bytes.length,2*1024*1024)));
    if(/\/(?:JavaScript|JS|Launch|OpenAction|EmbeddedFile|RichMedia|GoToE)\b/i.test(headSample))notes.push('The PDF has active-content markers. Loomwright will extract text only and won’t run its scripts or open embedded files.');
    return {ext,bytes,notes};
  }
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('This Word file is not a valid DOCX archive.');
  let count=0,uncompressedTotal=0,hasMacro=false,hasEmbedded=false,externalRelationship=false;
  let files;
  try{
    files=unzipSync(bytes,{filter:meta=>{
      count++;if(count>800)throw new Error('The Word file contains too many parts.');
      const name=String(meta.name||''),isRelationship=/(?:^|\/)_(?:rels)\/.*\.rels$/i.test(name)||/^_rels\/.*\.rels$/i.test(name);uncompressedTotal+=Number(meta.originalSize)||0;
      if(name.split('/').includes('..'))throw new Error('The Word file contains an unsafe internal path.');
      if(uncompressedTotal>50*1024*1024)throw new Error('The Word file expands beyond the safe 50 MB limit.');
      if(Number(meta.originalSize)>1024*1024&&(Number(meta.originalSize)/Math.max(1,Number(meta.size)||0))>500)throw new Error('The Word file contains an unusually compressed part.');
      if(isRelationship&&(Number(meta.originalSize)||0)>1024*1024)throw new Error('The Word file’s link information is unusually large.');
      if(/(?:^|\/)vbaProject\.bin$/i.test(name)||/\.(?:docm|dotm)$/i.test(name))hasMacro=true;
      if(/(?:^|\/)(?:embeddings|activex)(?:\/|$)|(?:^|\/)oleObject\d*\.bin$/i.test(name))hasEmbedded=true;
      return isRelationship||/^\[Content_Types\]\.xml$/i.test(name);
    }});
  }catch(error){throw new Error(error?.message?.includes('safe 50 MB')||error?.message?.includes('too many parts')?error.message:'The Word file could not be safely checked. It may be damaged or encrypted.')}
  const contentTypes=Object.entries(files||{}).find(([name])=>/^\[Content_Types\]\.xml$/i.test(name))?.[1];if(contentTypes&&/macroEnabled|vbaProject/i.test(new TextDecoder().decode(contentTypes)))hasMacro=true;
  if(hasMacro)throw new Error('This Word file contains a macro. Loomwright will not import macro-enabled documents. Save a macro-free .docx copy and try again.');
  if(hasEmbedded)throw new Error('This Word file contains an embedded object or ActiveX component. For safety, those documents are not imported.');
  for(const [name,data] of Object.entries(files||{}))if(/\.rels$/i.test(name)&&/TargetMode\s*=\s*["']External["']/i.test(new TextDecoder().decode(data)))externalRelationship=true;
  if(externalRelationship)notes.push('The Word file refers to outside links. Links and embedded images are removed; only cleaned writing is imported.');
  return {ext,bytes,notes};
}
function newProjectId(){return 'project-'+(window.crypto?.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2,9))}
function newProjectState(){return {...DEFAULT_STATE,sections:[{id:1,title:'Chapter 1',html:'<p></p>'}],charNotes:{},charProfiles:{},charConfirmed:{},charReviewResolved:{},charStatus:{},finaliseChecklist:{},charIgnore:{},charMerge:{},webNodes:[],webLinks:[],templates:[],book:{...DEFAULT_BOOK}}}
function normalizeSettings(settings){const next={palette:'sage',theme:'light',bgEffect:'none',navPosition:'top',zenIdleMinutes:2,...(settings||{})};if(!['sage','parchment','slate','forest','ink'].includes(next.palette))next.palette='sage';if(!['auto','light','dark'].includes(next.theme))next.theme='light';if(!['none','rain','clouds','snow','dragon'].includes(next.bgEffect))next.bgEffect='none';if(!['top','side'].includes(next.navPosition))next.navPosition='top';const timerNum=Number(next.zenIdleMinutes);next.zenIdleMinutes=[0,0.5,1,2,5,10,15].includes(timerNum)?timerNum:2;if(next.palette==='parchment'&&next.theme==='auto'){next.palette='sage';next.theme='light'}next.writing=normalizeWritingSettings(next.writing);return next}
function normalizeProjectState(value){const next=value&&typeof value==='object'?value:newProjectState();if(!Array.isArray(next.sections)||!next.sections.length)next.sections=newProjectState().sections;next.sections=next.sections.filter(s=>s&&typeof s==='object').map(s=>({...s,html:sanitizeRichHtml(s.html||'')}));if(!next.sections.length)next.sections=newProjectState().sections;delete next.settings;next.charNotes=next.charNotes||{};next.charProfiles=next.charProfiles&&typeof next.charProfiles==='object'?next.charProfiles:{};next.charConfirmed=next.charConfirmed&&typeof next.charConfirmed==='object'?next.charConfirmed:{};next.charReviewResolved=next.charReviewResolved&&typeof next.charReviewResolved==='object'?next.charReviewResolved:{};next.charStatus=next.charStatus||{};next.finaliseChecklist=next.finaliseChecklist||{};next.charIgnore=next.charIgnore||{};next.charMerge=next.charMerge||{};next.webPositions=next.webPositions||{};next.webNodes=Array.isArray(next.webNodes)?next.webNodes.filter(node=>node&&['place','event','object','thread'].includes(node.type)&&String(node.label||'').trim()).map(node=>({id:String(node.id||newProjectId()),type:node.type,label:String(node.label).trim().slice(0,80)})):[];next.webLinks=Array.isArray(next.webLinks)?next.webLinks.filter(link=>link&&typeof link.from==='string'&&typeof link.to==='string'):[];next.templates=Array.isArray(next.templates)?next.templates.filter(template=>template&&String(template.title||'').trim()&&typeof template.html==='string'&&template.html.length<=MAX_TEMPLATE_HTML_CHARS).slice(0,MAX_PROJECT_TEMPLATES).map(template=>({id:String(template.id||newProjectId()),title:String(template.title).trim().slice(0,120),html:sanitizeRichHtml(template.html),createdAt:template.createdAt||new Date().toISOString()})):[];next.book={...DEFAULT_BOOK,...(next.book||{})};return next}
let legacyState=null,projectStore=null;
try{legacyState=JSON.parse(localStorage.getItem('loomwright_state')||'null')}catch(e){}
try{projectStore=JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)||'null')}catch(e){}
const initialActiveId=projectStore?.activeProjectId||localStorage.getItem(ACTIVE_PROJECT_KEY)||'';
const initialActiveProject=projectStore?.projects?.find(p=>p.id===initialActiveId);
let appSettings,appSettingsStoredAtBoot=false,appSettingsTouched=false;
try{const savedAppSettings=JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)||'null');appSettingsStoredAtBoot=!!(savedAppSettings&&typeof savedAppSettings==='object');appSettings=normalizeSettings(savedAppSettings||initialActiveProject?.data?.settings||legacyState?.settings)}catch(e){appSettings=normalizeSettings(null)}
let projects=Array.isArray(projectStore?.projects)?projectStore.projects:[];
let activeProjectId=initialActiveId;
let deletedProjectIds=new Set();
try{const storedDeleted=JSON.parse(localStorage.getItem(DELETED_PROJECTS_STORAGE_KEY)||'[]');if(Array.isArray(storedDeleted))deletedProjectIds=new Set(storedDeleted.map(String))}catch(_){ }
if(!projects.length){activeProjectId=newProjectId();projects=[{id:activeProjectId,name:'My First Project',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),data:normalizeProjectState(legacyState)}]}
projects=projects.filter(p=>p&&p.id).map(p=>({...p,name:String(p.name||'Untitled Project'),createdAt:p.createdAt||new Date().toISOString(),updatedAt:p.updatedAt||p.createdAt||new Date().toISOString(),data:normalizeProjectState(p.data)}));
if(!projects.length){activeProjectId=newProjectId();projects=[{id:activeProjectId,name:'My First Project',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),data:newProjectState()}]}
if(!projects.some(p=>p.id===activeProjectId))activeProjectId=projects[0].id;
let state=normalizeProjectState(projects.find(p=>p.id===activeProjectId)?.data||legacyState);
let renamingProjectId=null;
let offlineDb=null,offlineSaveTimer=null,offlineWriteQueue=Promise.resolve(),offlineStorageReady=false,sharedSyncReady=false,sharedSyncBusy=false,sharedSyncPoll=null,sharedSyncTimer=null,sharedApplyingRecord=false;
function openOfflineDatabase(){return new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return}const request=indexedDB.open('loomwright-offline-library',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('library'))request.result.createObjectStore('library')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Could not open offline storage'))})}
function indexedRead(){return new Promise((resolve,reject)=>{const tx=offlineDb.transaction('library','readonly'),request=tx.objectStore('library').get('projects');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)})}
function indexedWrite(record){return new Promise((resolve,reject)=>{if(!offlineDb){resolve();return}const tx=offlineDb.transaction('library','readwrite');tx.objectStore('library').put(record,'projects');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Offline save failed'))})}
function currentProjectRecord(){return {version:PROJECT_RECORD_VERSION,activeProjectId,appSettings,deletedProjectIds:[...deletedProjectIds],projects,savedAt:Date.now()}}
function queueIndexedWrite(record){offlineWriteQueue=offlineWriteQueue.catch(()=>{}).then(()=>indexedWrite(record));return offlineWriteQueue}
function flushOfflineSave(){clearTimeout(offlineSaveTimer);return offlineDb?queueIndexedWrite(currentProjectRecord()):Promise.resolve()}
function persistProjectStore(){const record=currentProjectRecord(),hasIndexedDB=!!offlineDb,localRecord=hasIndexedDB?{...record,projects:projects.map(({id,name,createdAt,updatedAt})=>({id,name,createdAt,updatedAt}))}:record;try{localStorage.setItem(PROJECTS_STORAGE_KEY,JSON.stringify(localRecord));localStorage.setItem(ACTIVE_PROJECT_KEY,activeProjectId);localStorage.setItem(DELETED_PROJECTS_STORAGE_KEY,JSON.stringify([...deletedProjectIds]));if(!hasIndexedDB)localStorage.setItem('loomwright_state',JSON.stringify(state))}catch(e){if(hasIndexedDB)toast('Saved in offline storage; browser backup limit reached.');else{toast('Browser storage is full. Export a copy from Finalise.');return false}}if(offlineDb){clearTimeout(offlineSaveTimer);offlineSaveTimer=setTimeout(()=>queueIndexedWrite(record).catch(()=>toast('Offline save needs attention; export a copy from Finalise.')),180)}if(sharedSyncReady&&!sharedApplyingRecord)scheduleSharedSync();return true}
async function initializeOfflineStorage(){
  try{
    offlineDb=await openOfflineDatabase();let localRecord=null;
    try{localRecord=JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)||'null')}catch(e){}
    const localHasContent=Array.isArray(localRecord?.projects)&&localRecord.projects.some(p=>p.data&&Array.isArray(p.data.sections)),stored=await indexedRead(),storedHasContent=Array.isArray(stored?.projects)&&stored.projects.some(p=>p.data&&Array.isArray(p.data.sections)),localHasMetadata=Array.isArray(localRecord?.projects)&&localRecord.projects.length>0&&!localHasContent,useIndexed=storedHasContent&&(localHasMetadata||!localHasContent||(stored.savedAt||0)>(localRecord?.savedAt||0));
    deletedProjectIds=new Set([...(stored?.deletedProjectIds||[]),...(localRecord?.deletedProjectIds||[]),...deletedProjectIds].map(String));
    if(useIndexed&&!appSettingsStoredAtBoot&&!appSettingsTouched){const oldActive=stored.projects.find(p=>p.id===(stored.activeProjectId||activeProjectId)),storedSettings=stored.appSettings||oldActive?.data?.settings;if(storedSettings)appSettings=normalizeSettings(storedSettings)}
    if(useIndexed){const localMeta=new Map((localRecord?.projects||[]).filter(p=>p&&p.id).map(p=>[String(p.id),p]));const storedIds=new Set(stored.projects.filter(p=>p&&p.id).map(p=>String(p.id)));projects=stored.projects.filter(p=>p&&p.id&&(!localHasMetadata||localMeta.has(String(p.id)))).map(p=>({...p,...(localMeta.get(String(p.id))||{}),data:normalizeProjectState(p.data)}));if(localHasMetadata)(localRecord.projects||[]).filter(p=>p&&p.id&&!storedIds.has(String(p.id))).forEach(p=>projects.push({...p,data:newProjectState()}));if(!projects.length)throw new Error('Offline library is empty');activeProjectId=localRecord?.activeProjectId||stored.activeProjectId||projects[0].id;if(!projects.some(p=>p.id===activeProjectId))activeProjectId=projects[0].id;state=projects.find(p=>p.id===activeProjectId).data}
    offlineStorageReady=true;persistAppSettings();persistProjectStore();refreshProjectViews();setSyncStatus('Offline · this device',false);
  }catch(e){offlineDb=null;offlineStorageReady=true;persistAppSettings();if(projects.every(project=>project.data))persistProjectStore();refreshProjectViews();setSyncStatus('Offline · this browser',false)}
}
state.sections.forEach(s=>{if(s.text!==undefined&&!s.html){s.html=s.text.split(/\n\n+/).map(p=>'<p>'+escapeHtml(p)+'</p>').join('');delete s.text}});
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

let dbRef=null,dbSaveTimer=null,introTimer=null;
function setSyncStatus(msg,ok){const el=document.getElementById('sync-status');el.textContent=(ok?'● ':'○ ')+msg}
let deferredInstallPrompt=null;
function setOfflineAppStatus(message){const el=document.getElementById('offline-app-status');if(el)el.textContent=message}
function renderAppVersion(){const el=document.getElementById('app-version-settings');if(el)el.textContent=`v${APP_VERSION}`}
function renderGitStatus(data){
  const status=document.getElementById('about-git-status'),button=document.getElementById('git-update-button'),progress=document.getElementById('about-git-progress'),fill=document.getElementById('about-git-progress-fill');if(!status)return;
  const operation=data?.operation||{},running=Boolean(operation.running),hasError=!data?.silent&&(Boolean(data?.error)||operation.ok===false),percent=running?(operation.step==='push'?72:34):0;status.classList.toggle('is-running',running);status.classList.toggle('is-error',hasError);
  if(data?.error&&!data?.silent)status.textContent=data.error;else if(running)status.textContent=operation.step==='push'?'Updating local changes to GitHub…':'Updating Loomwright from GitHub…';
  status.hidden=!running&&!hasError;if(button)button.disabled=running;if(progress){progress.hidden=!running;progress.classList.toggle('is-complete',false);progress.classList.toggle('is-error',hasError)}if(fill)fill.style.width=`${percent}%`;
}
async function readGitResponse(response){const type=response.headers.get('content-type')||'';if(!type.includes('application/json')){await response.text();throw new Error('Update service unavailable. Pull the latest app code and restart the local server.')}const data=await response.json();if(!response.ok)throw new Error(data.error||'Git update could not start.');return data}
async function refreshGitStatus(){try{const response=await fetch(new URL('./api/git/status',import.meta.url),{cache:'no-store'});const data=await readGitResponse(response);renderGitStatus(data)}catch(error){renderGitStatus({error:error.message,silent:true})}}
async function runGitUpdate(){
  const button=document.getElementById('git-update-button');if(!button||button.disabled)return;button.disabled=true;renderGitStatus({operation:{running:true,step:'pull'}});
  try{const response=await fetch(new URL('./api/git/sync',import.meta.url),{method:'POST',headers:{'Content-Type':'application/json'}});const data=await readGitResponse(response);renderGitStatus(data);setTimeout(refreshGitStatus,700)}catch(error){renderGitStatus({error:error.message});if(button)button.disabled=false}
}
function setupGitSync(){document.getElementById('git-update-button')?.addEventListener('click',runGitUpdate);refreshGitStatus();setInterval(refreshGitStatus,5000)}
async function offlineCacheCount(){const names=(await caches.keys()).filter(name=>name.startsWith('loomwright-offline-'));let count=0;for(const name of names)count+=(await (await caches.open(name)).keys()).length;return count}
function updateInstallButton(){const button=document.getElementById('install-app');if(button)button.hidden=!deferredInstallPrompt}
async function prepareOfflineApp(){
  if(isLocalPreview()){setOfflineAppStatus('Local preview · refresh this tab after app files change.');return}
  if(!('serviceWorker'in navigator)||!window.isSecureContext){setOfflineAppStatus('To install and open while offline, use Loomwright from a secure website address (https) once. Your browser-saved books still work here.');return}
  const button=document.getElementById('prepare-offline');if(button)button.disabled=true;setOfflineAppStatus('Saving the app files on this device… no manuscript is sent.');
  try{
    const swUrl=new URL('./sw.js',import.meta.url),scopeUrl=new URL('./',import.meta.url),registration=await navigator.serviceWorker.register(swUrl,{scope:scopeUrl.pathname});
    const ready=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('This browser took too long to prepare the offline copy.')) ,45000))]);
    if(registration.installing||registration.waiting||registration.active){}
    const count=await offlineCacheCount();if(count<10)throw new Error('The local app files did not finish saving. Check your connection, then try again.');
    setOfflineAppStatus(`Ready for offline use on this device · ${count} app files saved. Open Loomwright once while connected again after future app updates.`);navigator.serviceWorker.controller?.postMessage({type:'CLIENT_READY'});
  }catch(error){setOfflineAppStatus(error?.message||'Offline preparation could not finish. Try again while connected.');}
  finally{if(button)button.disabled=false}
}
function setupOfflineApp(){
  const prepare=document.getElementById('prepare-offline'),install=document.getElementById('install-app');
  prepare?.addEventListener('click',prepareOfflineApp);
  install?.addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;updateInstallButton()});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallButton()});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;updateInstallButton();setOfflineAppStatus('Loomwright is installed. Use “Prepare offline” once while connected to save all app files.')});
  if(isLocalPreview()){setOfflineAppStatus('Local preview · refresh this tab after app files change.');clearOfflinePreviewCache();return}
  if(!('serviceWorker'in navigator)||!window.isSecureContext){setOfflineAppStatus('Offline installation needs a secure website address. Open Loomwright once while connected, then prepare the offline copy.');return}
  if('caches'in window){caches.keys().then(names=>names.filter(n=>n.startsWith('loomwright-offline-')&&n!=='loomwright-offline-v36').forEach(n=>caches.delete(n))).catch(()=>{});}
  navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname}).then(async registration=>{
    try{await registration.update()}catch(_){}
    await navigator.serviceWorker.ready;
    const count=await offlineCacheCount();
    if(count>=10)setOfflineAppStatus(`Offline copy ready · ${count} app files saved on this device.`);
    else setOfflineAppStatus('The app can be prepared for offline use from this setting.');
  }).catch(()=>setOfflineAppStatus('Offline preparation could not start. Reopen Loomwright while connected and try again.'));
}
function isLocalPreview(){return ['localhost','127.0.0.1','::1'].includes(location.hostname)}
async function clearOfflinePreviewCache(){
  if(!('serviceWorker'in navigator))return;
  const registrations=await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter(registration=>new URL(registration.scope).origin===location.origin).map(registration=>registration.unregister()));
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('loomwright-offline-')).map(name=>caches.delete(name)));
}
async function initDB(){
  try{
    if(!ONLINE_SYNC_ENABLED||!window.claude)return;
    dbRef=await claude.use('db');if(!dbRef)return;
    const doc=await dbRef.doc('data/state').get();
    if(doc&&doc.exists&&doc.data&&Array.isArray(doc.data.sections)&&doc.data.sections.length){
      const remoteProject={...doc.data},remoteSettings=remoteProject.settings;delete remoteProject.settings;
      if(remoteSettings&&!appSettingsStoredAtBoot&&!appSettingsTouched){appSettings=normalizeSettings(remoteSettings);persistAppSettings()}
      state=normalizeProjectState({...DEFAULT_STATE,...remoteProject,charNotes:doc.data.charNotes||{},finaliseChecklist:doc.data.finaliseChecklist||{},charIgnore:doc.data.charIgnore||{},charMerge:doc.data.charMerge||{}});
      localStorage.setItem('loomwright_state',JSON.stringify(state));renderSidebar();renderEditor();applyTheme();renderHome();
      if(remoteSettings)await dbRef.doc('data/state').set(state);
    }else{await dbRef.doc('data/state').set(state)}
    setSyncStatus('Synced',true);
  }catch(e){setSyncStatus('Local only',false)}
}
function sameSharedProjects(first,second){
  const ordered=record=>(record?.projects||[]).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const deleted=record=>[...(record?.deletedProjectIds||[])].map(String).sort();
  return JSON.stringify({projects:ordered(first),deletedProjectIds:deleted(first)})===JSON.stringify({projects:ordered(second),deletedProjectIds:deleted(second)});
}
function mergeSharedRecords(local,remote){
  const deleted=new Set([...(remote?.deletedProjectIds||[]),...(local?.deletedProjectIds||[])].map(String));
  const merged=new Map((remote?.projects||[]).map(project=>[String(project.id),project]));
  (local?.projects||[]).forEach(project=>{
    const id=String(project.id),previous=merged.get(id),localTime=Date.parse(project.updatedAt||project.createdAt||'')||0,remoteTime=Date.parse(previous?.updatedAt||previous?.createdAt||'')||0;
    if(!previous||localTime>remoteTime)merged.set(id,project);
  });
  const projects=[...merged.values()].filter(project=>project&&project.id&&!deleted.has(String(project.id)));
  const localActive=String(local?.activeProjectId||'');
  const remoteActive=String(remote?.activeProjectId||'');
  return {...remote,...local,deletedProjectIds:[...deleted],projects,activeProjectId:!deleted.has(localActive)&&merged.has(localActive)?local.activeProjectId:!deleted.has(remoteActive)&&merged.has(remoteActive)?remote.activeProjectId:projects[0]?.id};
}
function applySharedRecord(record){
  deletedProjectIds=new Set((record.deletedProjectIds||[]).map(String));
  const nextProjects=(record.projects||[]).filter(project=>project&&project.id&&!deletedProjectIds.has(String(project.id))).map(project=>({...project,name:String(project.name||'Untitled Project'),data:normalizeProjectState(project.data)}));
  if(!nextProjects.length)return;
  const currentId=projects.some(project=>String(project.id)===String(activeProjectId))?activeProjectId:record.activeProjectId;
  projects=nextProjects;activeProjectId=projects.some(project=>String(project.id)===String(currentId))?currentId:projects[0].id;
  state=projects.find(project=>String(project.id)===String(activeProjectId)).data;
  sharedApplyingRecord=true;
  try{persistProjectStore();refreshProjectViews()}finally{sharedApplyingRecord=false}
}
function writerHasFocus(){
  const workspace=document.getElementById('write-workspace'),active=document.activeElement;
  return !workspace.hidden&&workspace.contains(active)&&active.matches('input,textarea,[contenteditable="true"]');
}
async function requestSharedStore(method='GET',payload=null){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);
  try{return await fetch(new URL('./api/sync',import.meta.url),{method,cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined,signal:controller.signal})}
  finally{clearTimeout(timeout)}
}
async function syncSharedProjects(){
  if(sharedSyncBusy||writerHasFocus())return;
  sharedSyncBusy=true;
  try{
    let response=await requestSharedStore(),snapshot;
    if(!response.ok)throw new Error('Shared store unavailable.');
    snapshot=await response.json();
    for(let attempt=0;attempt<5;attempt++){
      const local=currentProjectRecord(),merged=snapshot.record?mergeSharedRecords(local,snapshot.record):local;
      if(!sameSharedProjects(local,merged))applySharedRecord(merged);
      const current=currentProjectRecord();
      if(snapshot.record&&sameSharedProjects(current,snapshot.record)){
        sharedSyncReady=true;setSyncStatus('Shared · this workspace',true);return;
      }
      response=await requestSharedStore('PUT',{expectedRevision:snapshot.revision,record:current});
      snapshot=await response.json();
      if(response.status===409)continue;
      if(!response.ok)throw new Error('Shared save failed.');
      sharedSyncReady=true;setSyncStatus('Shared · this workspace',true);return;
    }
    throw new Error('Shared data changed repeatedly.');
  }catch(error){setSyncStatus(sharedSyncReady?'Shared · reconnecting':'Local only · sync unavailable',false)}
  finally{sharedSyncBusy=false}
}
function startSharedSync(){
  if(!sharedSyncPoll)sharedSyncPoll=setInterval(syncSharedProjects,5000);
  return syncSharedProjects();
}
function scheduleSharedSync(){
  clearTimeout(sharedSyncTimer);
  sharedSyncTimer=setTimeout(syncSharedProjects,700);
}
function save(){
  delete state.settings;const project=projects.find(p=>p.id===activeProjectId);if(project){project.data=state;project.updatedAt=new Date().toISOString()}
  const persisted=persistProjectStore();
  if(ONLINE_SYNC_ENABLED&&dbRef){clearTimeout(dbSaveTimer);dbSaveTimer=setTimeout(async()=>{try{await dbRef.doc('data/state').set(state);setSyncStatus('Synced',true)}catch(e){setSyncStatus('Sync failed',false)}},800)}
  return persisted;
}
async function saveWriter(){
  flushWriterSave();
  const persisted=save();clearTimeout(offlineSaveTimer);
  try{if(offlineDb)await flushOfflineSave();else if(!persisted)return;toast('Saved on this device.')}catch(_){toast('Save failed. Export a copy from Finalise.')}
  updateUnsavedIndicator();
}
async function copyWriterSelection(){
  const selection=window.getSelection(),editor=document.getElementById('content-editable');
  if(!selection||!selection.toString().trim()||!editor?.contains(selection.anchorNode)){toast('Select text in your draft to copy.');return}
  try{await navigator.clipboard.writeText(selection.toString());toast('Selection copied.')}catch(_){if(document.execCommand('copy'))toast('Selection copied.');else toast('Clipboard access is unavailable. Use Ctrl/Cmd+C.')}
}
async function pasteIntoWriter(targetRange=null){
  try{const text=await navigator.clipboard.readText();if(!text){toast('The clipboard is empty.');return}const editor=document.getElementById('content-editable');if(targetRange){writerContextRange=targetRange;restoreWriterContextRange(editor)}else editor?.focus();if(!editor||!document.execCommand('insertText',false,text)){toast('Paste was unavailable. Use Ctrl/Cmd+V.');return}toast('Pasted from clipboard.')}catch(_){toast('Clipboard access is unavailable. Use Ctrl/Cmd+V to paste.')}
}
document.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
  const workspace=document.getElementById('write-workspace');if(workspace.hidden||!workspace.contains(event.target))return;
  const key=event.key.toLowerCase();
  if(key==='s'){event.preventDefault();saveWriter();return}
  if(event.target!==document.getElementById('content-editable'))return;
  if(key==='z'||key==='y'){event.preventDefault();cmd(key==='y'||event.shiftKey?'redo':'undo');return}
  const command={b:'bold',i:'italic',u:'underline'}[key];if(command){event.preventDefault();cmd(command)}
});
function persistAppSettings(){try{localStorage.setItem(APP_SETTINGS_KEY,JSON.stringify(appSettings));appSettingsStoredAtBoot=true;return true}catch(e){toast('Appearance settings could not be saved in this browser.');return false}}
function updateAppSetting(key,value){appSettings[key]=value;appSettingsTouched=true;persistAppSettings();persistProjectStore();applyTheme()}
let zenTimerId=null,zenModeActive=false;
function setZenMode(active){
  zenModeActive=Boolean(active);document.body.classList.toggle('zen-mode-active',zenModeActive);document.documentElement.dataset.zenActive=String(zenModeActive);
}
function scheduleZenMode(){
  clearTimeout(zenTimerId);zenTimerId=null;if(zenModeActive)return;const minutes=Number(appSettings.zenIdleMinutes||0);if(minutes>0)zenTimerId=setTimeout(()=>setZenMode(true),minutes*60*1000);
}
function recordZenActivity(){if(zenModeActive)setZenMode(false);scheduleZenMode()}
function setupZenMode(){
  const timer=document.getElementById('zen-timer-select'),enter=document.getElementById('btn-enter-zen');
  timer?.addEventListener('change',event=>{updateAppSetting('zenIdleMinutes',Number(event.target.value));if(!Number(event.target.value))setZenMode(false);scheduleZenMode()});
  enter?.addEventListener('click',()=>setZenMode(true));
  ['pointermove','pointerdown','keydown','wheel','touchstart','input'].forEach(type=>document.addEventListener(type,recordZenActivity,{passive:type!=='keydown'}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)recordZenActivity()});scheduleZenMode();
}

const COLUMN_WIDTH_MAP = {
  narrow: '640px',
  medium: '816px',
  wide: '1020px',
};

function getEffectiveIndent() {
  const s = state.sections.find(x => String(x.id) === String(state.activeId));
  if (s && s.firstLineIndent !== undefined && s.firstLineIndent !== null) {
    return Boolean(s.firstLineIndent);
  }
  return Boolean(appSettings?.writing?.firstLineIndent);
}

function updateUnsavedIndicator() {
  const el = document.getElementById('writer-unsaved-indicator');
  if (!el) return;
  if (!appSettings?.writing?.autosave && writerDirty) {
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function applyWritingSettingsLive() {
  const writing = appSettings?.writing || normalizeWritingSettings(null);
  const root = document.documentElement;
  const wrap = document.getElementById('editor-wrap');
  const editor = document.getElementById('content-editable');

  const font = BUNDLED_FONTS.includes(writing.fontFamily) ? writing.fontFamily : 'Lora';
  const sizePx = `${writing.fontSize}px`;
  const line = String(writing.lineHeight);
  const measure = COLUMN_WIDTH_MAP[writing.columnWidth] || '816px';

  root.style.setProperty('--editor-font', `'${font}', Georgia, serif`);
  root.style.setProperty('--editor-size', sizePx);
  root.style.setProperty('--editor-line', line);
  root.style.setProperty('--editor-measure', measure);

  if (wrap) {
    wrap.style.setProperty('--editor-font', `'${font}', Georgia, serif`);
    wrap.style.setProperty('--editor-size', sizePx);
    wrap.style.setProperty('--editor-line', line);
    wrap.style.setProperty('--editor-measure', measure);

    wrap.classList.toggle('page-style-paper', writing.pageStyle === 'paper');
    wrap.classList.toggle('page-style-flat', writing.pageStyle === 'flat');
    wrap.classList.toggle('has-first-line-indent', getEffectiveIndent());
    wrap.classList.toggle('toolbar-pinned', writing.toolbarMode === 'pinned');
    wrap.classList.toggle('toolbar-auto', writing.toolbarMode === 'auto');
  }

  if (editor) {
    editor.setAttribute('spellcheck', String(writing.spellcheck));
  }

  document.body.classList.toggle('focus-hide-nav', writing.focusHides?.nav !== false);
  document.body.classList.toggle('focus-hide-toolbar', writing.focusHides?.toolbar !== false);
  document.body.classList.toggle('focus-hide-footer', Boolean(writing.focusHides?.footer));

  const previewDoc = document.getElementById('writing-preview-doc');
  const previewBadge = document.getElementById('preview-style-badge');
  if (previewDoc) {
    previewDoc.style.setProperty('--preview-font', `'${font}', Georgia, serif`);
    previewDoc.style.setProperty('--preview-size', sizePx);
    previewDoc.style.setProperty('--preview-line', line);
    previewDoc.style.setProperty('--preview-measure', measure);

    previewDoc.classList.toggle('page-style-paper', writing.pageStyle === 'paper');
    previewDoc.classList.toggle('page-style-flat', writing.pageStyle === 'flat');
    previewDoc.classList.toggle('has-first-line-indent', Boolean(writing.firstLineIndent));
  }
  if (previewBadge) {
    const styleCap = writing.pageStyle.charAt(0).toUpperCase() + writing.pageStyle.slice(1);
    previewBadge.textContent = `${styleCap} · ${font} ${writing.fontSize}px`;
  }

  updateUnsavedIndicator();
  updateWriterStatus();
}

function updateWritingSetting(key, value) {
  if (!appSettings.writing) appSettings.writing = normalizeWritingSettings(null);
  appSettings.writing[key] = value;
  appSettings.writing = normalizeWritingSettings(appSettings.writing);
  appSettingsTouched = true;
  persistAppSettings();
  persistProjectStore();
  applyWritingSettingsLive();
  renderWritingSettingsUI();
  if (key === 'dashSeparatesWords') {
    recountAllSections();
  }
  if (key === 'recogniserSensitivity') {
    renderCharacters();
    renderWeb();
    renderMetrics();
  }
}

function renderWritingSettingsUI() {
  const writing = appSettings?.writing || normalizeWritingSettings(null);

  function setSegmented(id, value) {
    const group = document.getElementById(id);
    if (!group) return;
    group.querySelectorAll('.segmented-item').forEach(btn => {
      const active = btn.dataset.value === String(value);
      btn.setAttribute('aria-checked', String(active));
    });
  }

  function setSwitch(id, value) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.setAttribute('aria-checked', String(Boolean(value)));
  }

  function setRange(id, valId, value, formatter) {
    const input = document.getElementById(id);
    const readout = document.getElementById(valId);
    if (input) input.value = value;
    if (readout) readout.textContent = formatter(value);
  }

  setSegmented('writing-page-style', writing.pageStyle);
  setSegmented('writing-column-width', writing.columnWidth);

  const fontSelect = document.getElementById('writing-font-family');
  if (fontSelect) fontSelect.value = writing.fontFamily;

  setRange('writing-font-size', 'writing-font-size-val', writing.fontSize, v => `${v} px`);
  setRange('writing-line-height', 'writing-line-height-val', writing.lineHeight, v => `${v}`);
  setSwitch('writing-first-line-indent', writing.firstLineIndent);
  setSegmented('writing-toolbar-mode', writing.toolbarMode);
  setSwitch('writing-spellcheck', writing.spellcheck);
  setSwitch('writing-smart-quotes', writing.smartQuotes);
  setSwitch('writing-typewriter-scroll', writing.typewriterScroll);

  setSwitch('writing-focus-hide-nav', writing.focusHides.nav);
  setSwitch('writing-focus-hide-toolbar', writing.focusHides.toolbar);
  setSwitch('writing-focus-hide-footer', writing.focusHides.footer);

  setSwitch('writing-autosave', writing.autosave);
  setRange('writing-autosave-delay', 'writing-autosave-delay-val', writing.autosaveDelayMs, v => `${(v / 1000).toFixed(1)}s`);

  setRange('writing-daily-goal', 'writing-daily-goal-val', writing.dailyGoal, v => Number(v) === 0 ? 'Off' : `${v} w`);
  setSwitch('writing-dash-separates', writing.dashSeparatesWords);
  setSegmented('writing-recogniser-sensitivity', writing.recogniserSensitivity);
}

function performTypewriterScroll() {
  if (!appSettings?.writing?.typewriterScroll) return;
  const editor = document.getElementById('content-editable');
  if (!editor || document.activeElement !== editor) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0)) return;
  const viewportCenter = window.innerHeight / 2;
  const caretCenter = rect.top + (rect.height / 2);
  const delta = caretCenter - viewportCenter;
  if (Math.abs(delta) > 8) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: delta, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function applyTheme(){
  let resolved=appSettings.theme;
  if(resolved==='auto')resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  document.documentElement.setAttribute('data-theme',resolved);document.documentElement.setAttribute('data-palette',appSettings.palette);document.documentElement.setAttribute('data-bg-effect',appSettings.bgEffect||'none');
  const navPos = appSettings.navPosition === 'side' ? 'side' : 'top';
  document.documentElement.setAttribute('data-nav-position', navPos);
  document.body.classList.toggle('nav-side-mounted', navPos === 'side');
  const navToggle = document.getElementById('nav-position-toggle');
  if (navToggle) {
    navToggle.setAttribute('aria-checked', String(navPos === 'side'));
  }
  const navSegmented = document.getElementById('nav-position-segmented');
  if (navSegmented) {
    navSegmented.querySelectorAll('.segmented-item').forEach(btn => {
      const active = btn.dataset.navPos === navPos;
      btn.setAttribute('aria-checked', String(active));
    });
  }
  /* Recalculate sticky command-bar height whenever nav mode changes */
  requestAnimationFrame(() => {
    const cmdBar = document.querySelector('.write-workspace .writer-command-bar');
    if (cmdBar) document.documentElement.style.setProperty('--writer-bar-h', cmdBar.offsetHeight + 'px');
  });
  const palette=document.getElementById('palette-select'),theme=document.getElementById('theme-select'),bgfx=document.getElementById('bg-effect-select');
  if(palette)palette.value=appSettings.palette;if(theme)theme.value=appSettings.theme;
  if(bgfx){
    const rainOpt=bgfx.querySelector('option[value="rain"]');
    if(rainOpt)rainOpt.textContent='Water ripples';
    if(!bgfx.querySelector('option[value="snow"]')){
      const opt=document.createElement('option');opt.value='snow';opt.textContent='Snow';bgfx.appendChild(opt);
    }
    bgfx.value=appSettings.bgEffect||'none';
  }
  const zenTimer=document.getElementById('zen-timer-select');
  if(zenTimer){
    zenTimer.value=String(appSettings.zenIdleMinutes??2);
  }
  applyWritingSettingsLive();
  renderWritingSettingsUI();
}
const ROMAN_NUMERAL_MAP = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function parseRomanNumeral(str) {
  if (!str || !/^[ivxlcdm]+$/i.test(str)) return null;
  const s = str.toLowerCase();
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN_NUMERAL_MAP[s[i]];
    const next = ROMAN_NUMERAL_MAP[s[i+1]];
    if (next && cur < next) { val += (next - cur); i++; } else { val += cur; }
  }
  return val > 0 ? val : null;
}
const WORD_NUMBER_MAP = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
};
function parseWordNumber(str) {
  if (!str) return null;
  const parts = str.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0, current = 0, matched = false;
  for (const p of parts) {
    if (WORD_NUMBER_MAP[p] !== undefined) {
      matched = true;
      const n = WORD_NUMBER_MAP[p];
      if (n === 100) current = (current || 1) * 100;
      else current += n;
    } else return null;
  }
  total += current;
  return matched ? total : null;
}
function getChapterRank(title) {
  if (!title) return { rank: 500000, text: '' };
  const raw = String(title).trim().replace(/\.(docx|pdf|txt)$/i, '');
  const clean = raw.toLowerCase();
  if (/^(foreword|preface|introduction|intro|prelude)\b/.test(clean)) return { rank: -1000, text: raw };
  if (/^prologue\b/.test(clean)) return { rank: -900, text: raw };
  if (/^epilogue\b/.test(clean)) return { rank: 1000000, text: raw };
  if (/^(afterword|postscript|conclusion|outro|appendix|notes)\b/.test(clean)) return { rank: 1000100, text: raw };

  const partMatch = clean.match(/(?:part|book|act|volume|vol\.?)\s*([0-9ivxlcdm]+|\w+)/i);
  let partNum = 0;
  if (partMatch) {
    const pStr = partMatch[1];
    if (/^\d+$/.test(pStr)) partNum = parseInt(pStr, 10);
    else if (parseRomanNumeral(pStr)) partNum = parseRomanNumeral(pStr);
    else if (parseWordNumber(pStr)) partNum = parseWordNumber(pStr);
  }

  const numMatch = clean.match(/(?:chapter|ch\.?|chap\.?|section|sec\.?)\s*(\d+)/i) ||
                   clean.match(/^(\d+)[\s._\-:]/i) ||
                   clean.match(/(\d+)/);
  if (numMatch) {
    return { rank: (partNum * 10000) + parseInt(numMatch[1], 10), text: raw };
  }
  const romanMatch = clean.match(/(?:chapter|ch\.?|chap\.?)\s+([ivxlcdm]+)\b/i);
  if (romanMatch) {
    const val = parseRomanNumeral(romanMatch[1]);
    if (val !== null) return { rank: (partNum * 10000) + val, text: raw };
  }
  const wordMatch = clean.match(/(?:chapter|ch\.?|chap\.?)\s+([a-z\s\-]+)/i);
  if (wordMatch) {
    const val = parseWordNumber(wordMatch[1]);
    if (val !== null) return { rank: (partNum * 10000) + val, text: raw };
  }
  return { rank: (partNum ? partNum * 10000 : 500000), text: raw };
}
function compareChapterTitles(a, b) {
  const rankA = getChapterRank(a);
  const rankB = getChapterRank(b);
  if (rankA.rank !== rankB.rank) return rankA.rank - rankB.rank;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}
function naturalCompare(a, b) {
  return compareChapterTitles(a, b);
}
function textOf(html){
  if(!html)return '';
  const d=document.createElement('div');d.innerHTML=sanitizeRichHtml(html);
  d.querySelectorAll('p,div,li,h1,h2,br').forEach(el=>el.insertAdjacentText('afterend','\n'));
  return d.textContent||'';
}
function countWords(text, options = {}) {
  if (!text) return 0;
  const dashSeparates = options.dashSeparatesWords !== undefined
    ? options.dashSeparatesWords
    : (appSettings?.writing?.dashSeparatesWords ?? true);

  if (dashSeparates) {
    const separated = text.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\-]+/gu, ' ');
    const matches = separated.match(/\S+/g);
    return matches ? matches.length : 0;
  } else {
    const matches = text.match(/\S+/g);
    return matches ? matches.length : 0;
  }
}
function countWordsFast(text, options = {}) {
  return countWords(text, options);
}
function wc(html, options = {}) {
  if (!html) return 0;
  const clean = html.replace(/<[^>]*>/g, ' ');
  return countWords(clean, options);
}
function totalWords(){
  return state.sections.reduce((n,s)=>{
    if (s._wc === undefined) s._wc = wc(s.html||'');
    return n + s._wc;
  }, 0);
}
function totalCharacters(){return detectCharacters().length}

function recountAllSections() {
  state.sections.forEach(s => {
    delete s._wc;
    s._wc = wc(s.html || '');
  });
  updateWriterStatus();
  renderDocumentList();
  renderHome();
  renderMetrics();
  const s = state.sections.find(x => String(x.id) === String(state.activeId));
  const sel = document.getElementById('section-select');
  if (sel && s) {
    const opt = sel.querySelector(`option[value="${s.id}"]`);
    if (opt) opt.textContent = `${s.title || 'Untitled'} (${s._wc}w)`;
  }
}

let writerDirty = false;
let writerDebounceTimer = null;
let writerStatusTimer = null;

function flushWriterSave() {
  const editor = document.getElementById('content-editable');
  if (writerDirty && editor) {
    const s = state.sections.find(x => String(x.id) === String(state.activeId));
    if (s) {
      s.html = editor.innerHTML;
      s._wc = countWordsFast(editor.textContent);
    }
    writerDirty = false;
  }
  if (writerDebounceTimer) {
    clearTimeout(writerDebounceTimer);
    writerDebounceTimer = null;
  }
  if (writerStatusTimer) {
    clearTimeout(writerStatusTimer);
    writerStatusTimer = null;
  }
  updateUnsavedIndicator();
  save();
  const totalEl = document.getElementById('totalstats');
  if (totalEl) totalEl.textContent = totalWords().toLocaleString() + ' words';
}

function updateWriterStatusFast(editor) {
  const index = state.sections.findIndex(s => String(s.id) === String(state.activeId));
  const section = state.sections[index];
  if (!section) return;

  let currentWords;
  if (editor) {
    currentWords = countWordsFast(editor.textContent);
  } else if (section._wc !== undefined) {
    currentWords = section._wc;
  } else {
    currentWords = section._wc = wc(section.html || '');
  }
  section._wc = currentWords;

  const statusSec = document.getElementById('writer-status-section');
  const statusWords = document.getElementById('writer-status-words');
  const statusTotal = document.getElementById('writer-status-total');
  const goalEl = document.getElementById('writer-daily-goal-indicator');

  if (statusSec) statusSec.textContent = `Chapter ${Math.max(index + 1, 1)} of ${state.sections.length}`;
  if (statusWords) statusWords.textContent = currentWords.toLocaleString() + ' words';
  if (statusTotal) statusTotal.textContent = totalWords().toLocaleString() + ' words total';

  if (goalEl) {
    const dailyGoal = appSettings?.writing?.dailyGoal ?? 500;
    if (dailyGoal > 0) {
      goalEl.hidden = false;
      const pct = Math.min(100, Math.round((currentWords / dailyGoal) * 100));
      goalEl.textContent = `Goal: ${currentWords.toLocaleString()} / ${dailyGoal.toLocaleString()}w (${pct}%)`;
      goalEl.classList.toggle('goal-achieved', currentWords >= dailyGoal);
    } else {
      goalEl.hidden = true;
    }
  }

  updateUnsavedIndicator();
}

function updateWriterStatus(){
  const editor = document.getElementById('content-editable');
  updateWriterStatusFast(editor);
}

function switchView(name){
  flushWriterSave();
  if(name!=='write'){document.body.classList.remove('writer-focus');document.getElementById('writer-statusbar').hidden=true}
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+name));
  try {
    if(name==='home')renderHome();
    if(name==='projects')renderProjects();
    if(name==='write')showWriteLibrary();
    if(name==='metrics')renderMetrics();
    if(name==='characters')renderCharacters();
    if(name==='web'){webViewport.initialized=false;renderWeb()}
    if(name==='finalise')renderFinalise();
    if(name==='settings')applyTheme();
  } catch (err) {
    console.error(`Error opening view "${name}":`, err);
  }
  window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchView(t.dataset.view)));
document.querySelectorAll('[data-open-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.openView)));

function renderHome(){
  const words=totalWords(),sections=state.sections.length,characters=totalCharacters();
  document.getElementById('home-word-count').textContent=words.toLocaleString();document.getElementById('home-section-count').textContent=sections.toLocaleString();document.getElementById('home-character-count').textContent=characters.toLocaleString();
  const done=Object.values(state.finaliseChecklist).filter(Boolean).length,total=FINALISE_ITEMS.length,pct=Math.round(done/total*100);
  document.getElementById('home-finalise-progress').style.width=pct+'%';document.getElementById('home-finalise-label').textContent=`${done} of ${total} ready`;
  document.getElementById('totalstats').textContent=words.toLocaleString()+' words';
  const project=projects.find(p=>p.id===activeProjectId),activeSection=state.sections.find(section=>String(section.id)===String(state.activeId))||state.sections[0],sectionTitle=activeSection?.title||'Untitled section',excerpt=textOf(activeSection?.html||'').replace(/\s+/g,' ').trim(),resume=document.getElementById('home-continue-writing');
  document.getElementById('home-project-context').textContent=`${project?.name||'Untitled Project'} · ${projects.length} project${projects.length===1?'':'s'}`;
  document.getElementById('home-resume-section').textContent=sectionTitle;
  document.getElementById('home-resume-words').textContent=`${wc(activeSection?.html||'').toLocaleString()} words in this section`;
  document.getElementById('home-resume-edited').textContent=project?.updatedAt?`Edited ${formatProjectDate(project.updatedAt)}`:'Ready when you are';
  document.getElementById('home-resume-excerpt').textContent=excerpt?`“${excerpt.slice(0,180)}${excerpt.length>180?'…':''}”`:'Pick up where you left off and continue shaping the thread that connects it all.';
  if(resume)resume.onclick=()=>{switchView('write');openSection(activeSection?.id)};
  const characterPreview=document.getElementById('home-character-stack'),detectedCharacters=detectCharacters().slice(0,5);
  if(characterPreview)characterPreview.innerHTML=detectedCharacters.length?detectedCharacters.map(([name])=>`<span class="character-avatar" title="${escapeHtml(name)}">${escapeHtml(name.split(/\s+/).filter(Boolean).map(part=>part[0]||'').join('').slice(0,2).toUpperCase())}</span>`).join(''):'<span class="character-stack-empty">Your recurring characters will appear here.</span>';
  const characterLiveCount=document.getElementById('home-character-live-count');if(characterLiveCount)characterLiveCount.textContent=`${characters.toLocaleString()} recurring`;
  const webPreview=document.getElementById('home-web-preview'),webNodes=[...detectedCharacters.map(([name])=>name),...(state.webNodes||[]).map(node=>node.label)].slice(0,6);if(webPreview)webPreview.innerHTML=webNodes.length?webNodes.map((label,index)=>`<span class="web-mini-node web-mini-node-${index+1}" title="${escapeHtml(label)}">${escapeHtml(label.slice(0,1).toUpperCase())}</span>`).join(''):'<span class="web-mini-empty">Add a connection in Story Web.</span>';
  const webLiveCount=document.getElementById('home-web-live-count');if(webLiveCount)webLiveCount.textContent=`${(characters+(state.webNodes||[]).length).toLocaleString()} story nodes`;
  const ringValue=document.getElementById('home-finalise-ring-value'),ring=document.querySelector('.bento-progress-ring');if(ringValue)ringValue.textContent=`${pct}%`;if(ring)ring.style.setProperty('--finalise-progress',`${pct}%`);
  const recentList=document.getElementById('home-recent-sections'),recentSections=[activeSection,...state.sections.filter(section=>section!==activeSection)].filter(Boolean).slice(0,4);if(recentList){recentList.innerHTML=recentSections.map(section=>`<button class="home-recent-item" type="button" data-home-section="${escapeHtml(String(section.id))}"><span class="home-recent-index">${escapeHtml((section.title||'U').trim().slice(0,1).toUpperCase())}</span><span><strong>${escapeHtml(section.title||'Untitled section')}</strong><small>${wc(section.html||'').toLocaleString()} words</small></span><span class="home-recent-arrow">→</span></button>`).join('');recentList.querySelectorAll('[data-home-section]').forEach(button=>button.addEventListener('click',()=>{switchView('write');openSection(button.dataset.homeSection)}))}
}
function renderDocumentList(){
  const list=document.getElementById('document-list');
  if(!list)return;
  list.innerHTML='';
  const count=document.getElementById('write-document-count');
  if(count)count.textContent=`${state.sections.length} ${state.sections.length===1?'chapter':'chapters'}`;
  state.sections.forEach(section=>{
    const item=document.createElement('button');
    item.type='button';
    item.className='document-item'+(String(section.id)===String(state.activeId)?' active':'');
    item.setAttribute('data-id',String(section.id));
    item.innerHTML=`<div class="doc-thumb">${escapeHtml((section.title||'Untitled').trim().slice(0,1).toUpperCase()||'U')}</div><div class="doc-meta"><span class="doc-title">${escapeHtml(section.title||'Untitled')}</span><span class="doc-subtle">${wc(section.html||'')} words</span></div>`;
    item.addEventListener('click',()=>openSection(section.id));
    list.appendChild(item);
  });
  renderTemplateLibrary();
}
function renderTemplateLibrary(){
  const grid=document.getElementById('template-grid'),count=document.getElementById('template-count');
  if(!grid)return;
  const templates=Array.isArray(state.templates)?state.templates:[];
  if(count)count.textContent=`${templates.length} ${templates.length===1?'template':'templates'}`;
  grid.innerHTML='';
  if(!templates.length){
    grid.innerHTML='<div class="template-empty"><span class="template-empty-mark" aria-hidden="true">＋</span><div><strong>Your templates will appear here</strong><span>Upload a .txt or .docx template to start a new chapter from it.</span></div></div>';
    return;
  }
  templates.forEach(template=>{
    const card=document.createElement('article');card.className='template-card';
    const preview=textOf(template.html).replace(/\s+/g,' ').trim().slice(0,120)||'Blank writing template';
    card.innerHTML=`<button class="template-use" type="button" data-template-id="${escapeHtml(template.id)}" aria-label="Create a chapter from ${escapeHtml(template.title)}"><span class="template-card-top"><span class="template-mark" aria-hidden="true">T</span><span class="template-name">${escapeHtml(template.title)}</span></span><span class="template-preview">${escapeHtml(preview)}</span><span class="template-card-footer"><span>${wc(template.html).toLocaleString()} words</span><span>Use template →</span></span></button><button class="template-delete" type="button" data-delete-template="${escapeHtml(template.id)}" aria-label="Remove ${escapeHtml(template.title)} template" title="Remove template">×</button>`;
    card.querySelector('[data-template-id]').addEventListener('click',()=>createSectionFromTemplate(template.id));
    card.querySelector('[data-delete-template]').addEventListener('click',event=>{event.stopPropagation();if(!window.confirm(`Remove the “${template.title}” template? Existing chapters created from it will not change.`))return;state.templates=state.templates.filter(item=>item.id!==template.id);save();renderTemplateLibrary()});
    grid.appendChild(card);
  });
}
function showWriteLibrary(){
  flushWriterSave();
  document.body.classList.remove('writer-focus');
  document.getElementById('writer-statusbar').hidden=true;
  document.getElementById('write-library').hidden=false;
  document.getElementById('write-workspace').hidden=true;
  renderDocumentList();
}
function showWriteWorkspace(){
  document.getElementById('write-library').hidden=true;
  document.getElementById('write-workspace').hidden=false;
  document.getElementById('writer-statusbar').hidden=false;
  renderSidebar();
  renderEditor();
}
function openSection(id){
  flushWriterSave();
  const section=state.sections.find(item=>String(item.id)===String(id));
  if(!section)return;
  state.activeId=section.id;
  save();
  showWriteWorkspace();
}
function createSectionFromTemplate(templateId){
  const template=state.templates.find(item=>String(item.id)===String(templateId));if(!template)return;
  const id=Date.now()+Math.floor(Math.random()*1000);
  state.sections.push({id,title:template.title,html:sanitizeRichHtml(template.html)});state.activeId=id;save();renderHome();showWriteWorkspace();document.getElementById('title-input')?.focus();
}
function createBlankDocument(){
  addSection();
  showWriteWorkspace();
  document.getElementById('title-input')?.focus();
}
function getChapterMetrics(){
  const names=detectCharacters().map(([name])=>name);
  return state.sections.map(section=>{
    const text=textOf(section.html||''),words=wc(section.html||''),characterMentions={};
    names.forEach(name=>{
      const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const matches=text.match(new RegExp(`\\b${escaped}\\b`,'gi'));
      if(matches)characterMentions[name]=matches.length;
    });
    return {id:section.id,title:section.title||'Untitled',words,pageEstimate:Math.ceil(words/250),characterMentions,characterCount:Object.keys(characterMentions).length};
  });
}
let metricMode='words',selectedMetricChapterId=null,metricCharacterFilter='';
function renderMetrics(){
  const shell=document.getElementById('metrics-shell');
  if(!shell)return;
  const chapters=getChapterMetrics(),totalWords=chapters.reduce((sum,item)=>sum+item.words,0),totalPages=chapters.reduce((sum,item)=>sum+item.pageEstimate,0);
  const averageWords=chapters.length?Math.round(totalWords/chapters.length):0,characters=detectCharacters(),mostActive=characters[0];
  const colors=['#65a886','#d59b55','#6d9ac5','#d4745c','#8d83bf','#4da8a1','#bf718d','#b0a951'];
  if(!chapters.some(chapter=>String(chapter.id)===String(selectedMetricChapterId)))selectedMetricChapterId=String(state.activeId??chapters[0]?.id??'');
  const selectedChapter=chapters.find(chapter=>String(chapter.id)===String(selectedMetricChapterId))||chapters[0];
  const metricOptions={words:{label:'Words',unit:'words',value:chapter=>chapter.words},pages:{label:'Pages',unit:'pages',value:chapter=>chapter.pageEstimate},characters:{label:'Characters',unit:'characters',value:chapter=>chapter.characterCount}};
  const currentMetric=metricOptions[metricMode]||metricOptions.words,maxMetric=Math.max(...chapters.map(currentMetric.value),0);
  const chapterRows=chapters.map((chapter,index)=>{const value=currentMetric.value(chapter),width=maxMetric?Math.max(value?2:0,value/maxMetric*100):0;return `<button class="metric-chart-row" type="button" data-metric-chapter="${escapeHtml(String(chapter.id))}" aria-pressed="${String(chapter.id)===String(selectedMetricChapterId)}" style="--metric-color:${colors[index%colors.length]}"><span class="metric-chart-label" title="${escapeHtml(chapter.title)}">${escapeHtml(chapter.title)}</span><span class="metric-track" aria-hidden="true"><span class="metric-bar" style="display:block;width:${width}%"></span></span><span class="metric-chart-value">${value.toLocaleString()}</span></button>`}).join('');
  const highestWordChapter=chapters.reduce((top,item)=>item.words>(top?.words??-1)?item:top,null),highestCharacterChapter=chapters.reduce((top,item)=>item.characterCount>(top?.characterCount??-1)?item:top,null);
  const chapterHeaders=chapters.map(chapter=>`<th scope="col">${escapeHtml(chapter.title)}</th>`).join('');
  const characterRows=characters.map(([name])=>`<tr><th scope="row">${escapeHtml(name)}</th>${chapters.map(chapter=>`<td>${chapter.characterMentions[name]||'—'}</td>`).join('')}</tr>`).join('');
  shell.innerHTML=`<div class="metrics-summary">
      <div class="metric-pill" style="--metric-accent:#65a886"><span class="label">Drafted</span><span class="value">${totalWords.toLocaleString()}</span><span class="detail">Words across ${chapters.length} chapters</span></div>
      <div class="metric-pill" style="--metric-accent:#6d9ac5"><span class="label">Estimated length</span><span class="value">${totalPages.toLocaleString()}</span><span class="detail">Pages at 250 words per page</span></div>
      <div class="metric-pill" style="--metric-accent:#d59b55"><span class="label">Chapter average</span><span class="value">${averageWords.toLocaleString()}</span><span class="detail">Words per chapter</span></div>
      <div class="metric-pill" style="--metric-accent:#d4745c"><span class="label">Most mentioned</span><span class="value">${mostActive?escapeHtml(mostActive[0]):'—'}</span><span class="detail">${mostActive?`${mostActive[1].count.toLocaleString()} mentions`:'No recurring characters yet'}</span></div>
    </div>
    <div class="metric-grid">
      <article class="metric-card"><div class="metric-card-header"><div><h3>Chapter comparison</h3><p>Choose a measure to compare chapter by chapter.</p></div><div class="metric-mode" role="group" aria-label="Compare chapters by">${Object.entries(metricOptions).map(([key,option])=>`<button type="button" data-metric-mode="${key}" aria-pressed="${key===metricMode}">${option.label}</button>`).join('')}</div></div><div class="metric-chart">${chapterRows||'<p class="empty">Add a chapter to start comparing your draft.</p>'}</div><div class="metric-chapter-detail"><div><strong>${selectedChapter?escapeHtml(selectedChapter.title):'No chapter selected'}</strong><span>${selectedChapter?`${selectedChapter.words.toLocaleString()} words · ${selectedChapter.pageEstimate} estimated pages · ${selectedChapter.characterCount} recurring characters`:''}</span></div>${selectedChapter?'<button class="metric-chapter-open" type="button" data-open-metric-chapter>Open chapter</button>':''}</div></article>
      <article class="metric-card"><div class="metric-card-header"><div><h3>Highlights</h3><p>Quick manuscript signals.</p></div></div><div class="metric-milestones"><div class="metric-milestone"><span>Longest chapter</span><strong>${highestWordChapter?escapeHtml(highestWordChapter.title):'—'}</strong></div><div class="metric-milestone"><span>Most characters</span><strong>${highestCharacterChapter?escapeHtml(highestCharacterChapter.title):'—'}</strong></div><div class="metric-milestone"><span>Recurring characters</span><strong>${characters.length.toLocaleString()}</strong></div><div class="metric-milestone"><span>Sections</span><strong>${chapters.length.toLocaleString()}</strong></div></div></article>
      <article class="metric-card metric-character-card"><div class="metric-card-header"><div><h3>Character mentions</h3><p>Mentions by chapter across your recurring cast.</p></div><div class="metric-character-tools"><input id="metric-character-filter" type="search" placeholder="Find a character" aria-label="Find a character"><span class="template-count" id="metric-character-count"></span></div></div><div class="metric-table-wrap"><table class="metric-table"><thead><tr><th scope="col">Character</th>${chapterHeaders}</tr></thead><tbody>${characterRows||`<tr><td colspan="${chapters.length+1}">Recurring characters will appear here as your draft develops.</td></tr>`}</tbody></table></div></article>
    </div>`;
  shell.querySelectorAll('[data-metric-mode]').forEach(button=>button.addEventListener('click',()=>{metricMode=button.dataset.metricMode;renderMetrics()}));
  shell.querySelectorAll('[data-metric-chapter]').forEach(button=>button.addEventListener('click',()=>{selectedMetricChapterId=button.dataset.metricChapter;renderMetrics()}));
  shell.querySelector('[data-open-metric-chapter]')?.addEventListener('click',()=>{const chapter=state.sections.find(item=>String(item.id)===String(selectedMetricChapterId));if(chapter){switchView('write');openSection(chapter.id)}});
  const filter=shell.querySelector('#metric-character-filter'),count=shell.querySelector('#metric-character-count');
  if(filter){filter.value=metricCharacterFilter;const updateFilter=()=>{metricCharacterFilter=filter.value.trim().toLocaleLowerCase();let visible=0;shell.querySelectorAll('.metric-table tbody tr').forEach(row=>{row.hidden=!!metricCharacterFilter&&!row.textContent.toLocaleLowerCase().includes(metricCharacterFilter);if(!row.hidden)visible++});count.textContent=`${visible} ${visible===1?'character':'characters'}`};filter.addEventListener('input',updateFilter);updateFilter()}
}
function formatProjectDate(value){const date=new Date(value||Date.now());return Number.isNaN(date.getTime())?'Recently edited':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
function renderProjects(){
  const grid=document.getElementById('project-grid');grid.innerHTML='';
  projects.forEach(project=>{
    const card=document.createElement('article');card.className='project-card'+(project.id===activeProjectId?' current':'');
    if(project.id===renamingProjectId){
      const form=document.createElement('form');form.className='project-rename-form';
      const input=document.createElement('input');input.id='project-name-edit';input.type='text';input.value=project.name;input.maxLength=80;input.required=true;input.setAttribute('aria-label','Project name');
      form.addEventListener('submit',event=>{event.preventDefault();saveProjectRename(project.id,input.value)});
      const saveName=document.createElement('button');saveName.type='submit';saveName.className='primary-button';saveName.textContent='Save';
      const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='Cancel';cancel.onclick=()=>{renamingProjectId=null;renderProjects()};
      form.append(input,saveName,cancel);card.appendChild(form);
    }else{const title=document.createElement('h3');title.textContent=project.name;card.appendChild(title)}
    const meta=document.createElement('div');meta.className='project-card-meta';const projectData=project.data||newProjectState();meta.textContent=`${projectData.sections?.length||0} section${(projectData.sections?.length||0)===1?'':'s'} · ${(projectData.sections||[]).reduce((n,s)=>n+wc(s.html||''),0).toLocaleString()} words · Edited ${formatProjectDate(project.updatedAt)}`;card.appendChild(meta);
    if(project.id===activeProjectId){const badge=document.createElement('span');badge.className='progress-label';badge.textContent='Current project';card.appendChild(badge)}
    const actions=document.createElement('div');actions.className='project-actions';
    const open=document.createElement('button');open.type='button';open.className=project.id===activeProjectId?'primary-button':'secondary-button';open.textContent=project.id===activeProjectId?'Open current':'Open project';open.onclick=()=>activateProject(project.id);actions.appendChild(open);
    if(project.id!==renamingProjectId){const rename=document.createElement('button');rename.type='button';rename.className='secondary-button';rename.textContent='Rename';rename.onclick=()=>renameProject(project.id);actions.appendChild(rename)}
    const remove=document.createElement('button');remove.type='button';remove.className='del';remove.textContent='Delete';remove.disabled=projects.length<2;remove.title=projects.length<2?'Keep at least one project':'Delete this project from this browser';remove.onclick=()=>deleteProject(project.id);actions.appendChild(remove);
    card.appendChild(actions);grid.appendChild(card);
  });
  if(!projects.length)grid.innerHTML='<div class="project-empty">No projects yet. Create one above to start a book.</div>';
}
function refreshProjectViews(){renderSidebar();renderEditor();applyTheme();renderHome();renderProjects();renderFinalise()}
function activateProject(id){const project=projects.find(p=>p.id===id);if(!project)return;const changed=id!==activeProjectId;if(changed){save();activeProjectId=id;state=project.data;persistProjectStore();refreshProjectViews()}switchView('write');if(changed)toast('Opened '+project.name+'.')}
function createProject(name){const clean=String(name||'').trim().slice(0,80);if(!clean){toast('Add a name for the project.');return}save();const now=new Date().toISOString(),project={id:newProjectId(),name:clean,createdAt:now,updatedAt:now,data:newProjectState()};projects.unshift(project);activeProjectId=project.id;state=project.data;persistProjectStore();refreshProjectViews();switchView('home');toast('Created '+clean+'.')}
function renameProject(id){if(!projects.some(project=>project.id===id))return;renamingProjectId=id;renderProjects();const input=document.getElementById('project-name-edit');input?.focus();input?.select()}
function saveProjectRename(id,value){const project=projects.find(item=>item.id===id);if(!project)return;const clean=String(value||'').trim().slice(0,80);if(!clean){toast('Project name cannot be empty.');document.getElementById('project-name-edit')?.focus();return}project.name=clean;project.updatedAt=new Date().toISOString();renamingProjectId=null;persistProjectStore();renderProjects();renderHome();renderBookPreview();toast('Project renamed.')}
async function deleteProject(id){if(projects.length<2){toast('Keep at least one project in your library.');return}const project=projects.find(p=>p.id===id);if(!project||!await showConfirmDialog('Delete project?',`Delete “${project.name}” and all of its writing from this browser? This cannot be undone.`))return;deletedProjectIds.add(String(id));projects=projects.filter(p=>p.id!==id);if(activeProjectId===id){activeProjectId=projects[0].id;state=projects[0].data}persistProjectStore();void flushOfflineSave().catch(()=>toast('Project deleted here, but the offline save needs attention.'));refreshProjectViews();switchView('projects');toast('Project deleted from this browser.')}
function renderSidebar(){
  const sel=document.getElementById('section-select');sel.innerHTML='';
  state.sections.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${s.title||'Untitled'} (${wc(s.html||'')}w)`;sel.appendChild(o)});
  sel.value=state.activeId;sel.onchange=()=>{state.activeId=Number(sel.value);save();renderEditor();renderDocumentList()};
  document.getElementById('totalstats').textContent=totalWords().toLocaleString()+' words';
  renderDocumentList();
}
function cmd(command,value=null){const editor=document.getElementById('content-editable');editor?.focus();document.execCommand(command,false,value);if(editor)dispatchWriterInput(editor)}
const BOOK_FONTS=[
  {group:'Manuscript standard',fonts:['Times New Roman','Georgia','Garamond','Book Antiqua','Cambria','Courier New','Calibri','Arial']},
  {group:'Book typeset',fonts:['EB Garamond','Libre Baskerville','Lora','Merriweather','Crimson Text','Playfair Display','PT Serif','Bitter']}
];
const RIBBON_ICONS={
  save:'<path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/>',
  cut:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 12M8 16 20 4"/>',
  paste:'<path d="M9 4h6l1 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1-2Z"/><path d="M9 4a3 3 0 0 1 6 0M8 11h8M8 15h8"/>',
  undo:'<path d="m9 14-5-5 5-5M4 9h10a6 6 0 1 1 0 12h-2"/>',
  redo:'<path d="m15 14 5-5-5-5m5 5H10a6 6 0 1 0 0 12h2"/>',
  alignLeft:'<path d="M4 5h16M4 9h11M4 13h16M4 17h11M4 21h16"/>',
  alignCenter:'<path d="M4 5h16M7 9h10M4 13h16M7 17h10M4 21h16"/>',
  alignRight:'<path d="M4 5h16M9 9h11M4 13h16M9 17h11M4 21h16"/>',
  alignJustify:'<path d="M4 5h16M4 9h16M4 13h16M4 17h16M4 21h16"/>',
  bullets:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  numbers:'<path d="M10 6h10M10 12h10M10 18h10M4 5h2v3M4 11h2l-2 2h2M4 17h2v2H4"/>',
  trash:'<path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-6 5v6m4-6v6"/>'
};
function ribbonIcon(name){return `<svg class="ribbon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RIBBON_ICONS[name]}</svg>`}
const WRITER_THEME_COLORS=['#ffffff','#000000','#e7e6e6','#44546a','#5b9bd5','#ed7d31','#a5a5a5','#ffc000','#4472c4','#70ad47'];
const WRITER_STANDARD_COLORS=['#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0','#002060','#7030a0'];
let writerContextRange=null,writerContextPopover=null,writerColorRange=null;
function tintHex(hex,amount){const value=hex.slice(1),channels=[0,2,4].map(index=>parseInt(value.slice(index,index+2),16));return '#'+channels.map(channel=>Math.round(255-(255-channel)*amount/100).toString(16).padStart(2,'0')).join('')}
function colorSwatchButton(color,label){return `<button type="button" class="tb-palette-swatch" data-palette-color="${color}" style="--swatch:${color}" aria-label="${label}" title="${label}"></button>`}
function colorPickerMarkup(id,label,glyph,highlight=false){
  const theme=WRITER_THEME_COLORS.map(color=>colorSwatchButton(color,`Theme ${color}`)).join('');
  const shades=[90,75,55,35].map(amount=>WRITER_THEME_COLORS.map(color=>colorSwatchButton(tintHex(color,amount),`Lighter ${color}`)).join('')).join('');
  const standard=WRITER_STANDARD_COLORS.map(color=>colorSwatchButton(color,`Standard ${color}`)).join('');
  return `<div class="tb-color-picker" id="${id}" data-color-kind="${highlight?'highlight':'text'}">
    <button type="button" class="tb-color-trigger" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false" title="${label}"><span class="tb-color-swatch${highlight?' highlight-swatch':''}">${glyph}<i></i></span></button>
    <div class="tb-color-menu" role="dialog" aria-label="${label} palette" hidden>
      ${highlight?'<button type="button" class="tb-no-color" data-clear-highlight>No Color</button>':''}
      <div class="tb-palette-heading">Theme Colors</div><div class="tb-theme-colors">${theme}</div><div class="tb-theme-shades">${shades}</div>
      <div class="tb-palette-heading tb-standard-heading">Standard Colors</div><div class="tb-standard-colors">${standard}</div>
      <div class="tb-palette-footer"><button type="button" data-custom-color>More Colors...</button><input type="color" value="${highlight?'#fff59d':'#000000'}" aria-label="Choose custom ${label.toLowerCase()}" tabindex="-1"></div>
    </div>
  </div>`
}
function closeWriterColorMenus(){document.querySelectorAll('.tb-color-menu:not([hidden])').forEach(menu=>{menu.hidden=true;menu.closest('.tb-color-picker')?.querySelector('.tb-color-trigger')?.setAttribute('aria-expanded','false')})}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.tb-color-picker'))closeWriterColorMenus()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeWriterColorMenus()});
function restoreWriterContextRange(editor){
  if(!writerContextRange)return false;
  editor.focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(writerContextRange);return true;
}
function closeWriterContextPopover(){if(writerContextPopover)writerContextPopover.hidden=true}
function dispatchWriterInput(editor){editor.dispatchEvent(new Event('input',{bubbles:true}))}
function ensureWriterContextPopover(){
  if(writerContextPopover)return writerContextPopover;
  const fontOptions=BOOK_FONTS.flatMap(group=>group.fonts).map(font=>`<option value="${escapeHtml(font)}">${escapeHtml(font)}</option>`).join('');
  const popover=document.createElement('div');popover.id='writer-context-popover';popover.className='writer-context-popover';popover.hidden=true;popover.setAttribute('aria-label','Writing selection tools');
  popover.innerHTML=`<div class="writer-context-mini" role="toolbar" aria-label="Quick formatting">
      <button type="button" data-context-command="bold" aria-label="Bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button><button type="button" data-context-command="italic" aria-label="Italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button><button type="button" data-context-command="underline" aria-label="Underline" title="Underline (Ctrl/Cmd+U)"><u>U</u></button>
      <select data-context-font aria-label="Font family"><option value="">Font</option>${fontOptions}</select><select data-context-size aria-label="Font size"><option value="">Size</option>${[10,11,12,14,16,18,20,24,28,32].map(size=>`<option value="${size}">${size}</option>`).join('')}</select>
      <input type="color" data-context-color aria-label="Text color" title="Text color" value="#26362d">
    </div><div class="writer-context-menu" role="menu" aria-label="Selection actions">
      <button type="button" role="menuitem" data-context-action="cut">${ribbonIcon('cut')}<span>Cut</span><kbd>Ctrl+X</kbd></button>
      <button type="button" role="menuitem" data-context-action="copy">${ribbonIcon('copy')}<span>Copy</span><kbd>Ctrl+C</kbd></button>
      <button type="button" role="menuitem" data-context-action="paste">${ribbonIcon('paste')}<span>Paste</span><kbd>Ctrl+V</kbd></button>
      <span class="writer-context-separator"></span>
      <button type="button" role="menuitem" data-context-action="select-all"><span class="context-menu-symbol">A</span><span>Select all</span><kbd>Ctrl+A</kbd></button>
      <button type="button" role="menuitem" data-context-command="removeFormat"><span class="context-menu-symbol">Tx</span><span>Clear formatting</span></button>
      <span class="writer-context-separator"></span>
      <div class="writer-context-align" role="group" aria-label="Paragraph alignment"><button type="button" data-context-command="justifyLeft" aria-label="Align left" title="Align left">${ribbonIcon('alignLeft')}</button><button type="button" data-context-command="justifyCenter" aria-label="Center" title="Center">${ribbonIcon('alignCenter')}</button><button type="button" data-context-command="justifyRight" aria-label="Align right" title="Align right">${ribbonIcon('alignRight')}</button><button type="button" data-context-command="justifyFull" aria-label="Justify" title="Justify">${ribbonIcon('alignJustify')}</button></div>
    </div>`;
  document.body.appendChild(popover);writerContextPopover=popover;
  popover.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault()});
  popover.addEventListener('click',async event=>{
    const commandButton=event.target.closest('[data-context-command]');
    if(commandButton){const editor=document.getElementById('content-editable');restoreWriterContextRange(editor);document.execCommand(commandButton.dataset.contextCommand,false);dispatchWriterInput(editor);closeWriterContextPopover();return}
    const actionButton=event.target.closest('[data-context-action]');if(!actionButton)return;
    const editor=document.getElementById('content-editable'),action=actionButton.dataset.contextAction;
    if(action==='select-all'){editor.focus();const range=document.createRange();range.selectNodeContents(editor);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);closeWriterContextPopover();return}
    if(action==='paste'){await pasteIntoWriter(writerContextRange?.cloneRange()||null);closeWriterContextPopover();return}
    const range=writerContextRange?.cloneRange(),text=range?.toString()||'';if(!range||range.collapsed||!text){toast(`Select text in your draft to ${action}.`);return}
    try{await navigator.clipboard.writeText(text);if(action==='cut'){restoreWriterContextRange(editor);document.execCommand('delete',false);dispatchWriterInput(editor)}toast(action==='cut'?'Selection cut.':'Selection copied.');closeWriterContextPopover()}catch(_){toast('Clipboard access is unavailable.')}
  });
  popover.addEventListener('change',event=>{
    const editor=document.getElementById('content-editable');restoreWriterContextRange(editor);
    if(event.target.matches('[data-context-font]'))document.execCommand('fontName',false,event.target.value);
    else if(event.target.matches('[data-context-size]'))setFontSize(event.target.value);
    else if(event.target.matches('[data-context-color]'))document.execCommand('foreColor',false,event.target.value);
    else return;
    dispatchWriterInput(editor);closeWriterContextPopover();
  });
  document.addEventListener('pointerdown',event=>{if(!popover.contains(event.target))closeWriterContextPopover()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeWriterContextPopover()});
  window.addEventListener('resize',closeWriterContextPopover);window.addEventListener('scroll',closeWriterContextPopover,true);
  return popover;
}
function showWriterContextPopover(editor,event){
  const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
  writerContextRange=range&&editor.contains(range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentNode)?range.cloneRange():null;
  const popover=ensureWriterContextPopover(),hasSelection=!!(writerContextRange&&!writerContextRange.collapsed&&writerContextRange.toString().trim());
  popover.querySelector('.writer-context-mini').hidden=!hasSelection;
  popover.querySelector('[data-context-action="copy"]').disabled=!hasSelection;popover.querySelector('[data-context-action="cut"]').disabled=!hasSelection;
  popover.hidden=false;popover.style.left='0px';popover.style.top='0px';
  const bounds=popover.getBoundingClientRect(),left=Math.max(8,Math.min(event.clientX,innerWidth-bounds.width-8)),top=Math.max(8,Math.min(event.clientY+8,innerHeight-bounds.height-8));
  popover.style.left=`${left}px`;popover.style.top=`${top}px`;
}
function setFontSize(px){
  document.execCommand('fontSize',false,'7');
  const editor=document.getElementById('content-editable');
  editor.querySelectorAll('font[size="7"]').forEach(el=>{el.removeAttribute('size');el.style.fontSize=px+'px'});
  editor.focus();
}
function safeLineHeight(value){const n=Number(value);return [1.4,1.6,1.7,1.8,2.2].includes(n)?n:1.7}
function applyWriterColor(editor,kind,color){
  if(!editor)return;
  editor.focus();
  if(writerColorRange){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(writerColorRange)}
  const command=kind==='highlight'?'hiliteColor':'foreColor',applied=document.execCommand(command,false,color);
  if(!applied&&kind==='highlight')document.execCommand('backColor',false,color);
  document.querySelector(`#tb-${kind==='highlight'?'highlight':'forecolor'}-picker .tb-color-swatch`)?.style.setProperty('--picked-color',color);
  dispatchWriterInput(editor);writerColorRange=null;
}
function setHighlight(color){applyWriterColor(document.getElementById('content-editable'),'highlight',color)}
function setLineSpacing(val){const s=state.sections.find(x=>String(x.id)===String(state.activeId));if(!s)return;s.lineHeight=safeLineHeight(val);save();const el=document.getElementById('content-editable');if(el)el.style.lineHeight=s.lineHeight}
function renderEditor(){
  const s=state.sections.find(x=>String(x.id)===String(state.activeId)),wrap=document.getElementById('editor-wrap');
  if(!s){wrap.innerHTML='<div class="empty">No chapter selected.</div>';return}
  const fontOptions=BOOK_FONTS.map(g=>`<optgroup label="${g.group}">${g.fonts.map(f=>`<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('')}</optgroup>`).join('');
  wrap.innerHTML=`<div class="writer-sticky-header"><input type="text" id="title-input" aria-label="Chapter title" placeholder="Chapter title" value="${escapeHtml(s.title||'Untitled')}">
    <div class="toolbar" aria-label="Formatting tools">
      <div class="tb-group" role="group" aria-label="Clipboard">
        <button type="button" id="writer-save" aria-label="Save" title="Save (Ctrl/Cmd+S)">${ribbonIcon('save')}</button><button type="button" id="writer-copy" aria-label="Copy" title="Copy selected text">${ribbonIcon('copy')}</button><button type="button" id="writer-paste" aria-label="Paste" title="Paste plain text at the cursor">${ribbonIcon('paste')}</button><span class="tb-group-label">Clipboard</span>
      </div>
      <div class="tb-group" role="group" aria-label="History">
        <button type="button" data-cmd="undo" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">${ribbonIcon('undo')}</button><button type="button" data-cmd="redo" aria-label="Redo" title="Redo (Ctrl/Cmd+Y)">${ribbonIcon('redo')}</button><span class="tb-group-label">History</span>
      </div>
      <div class="tb-group" role="group" aria-label="Font">
        <select id="tb-font" class="tb-font-select" aria-label="Font family"><option value="">Font ▾</option>${fontOptions}</select>
        <select id="tb-size" aria-label="Font size"><option value="">Size ▾</option>${[10,11,12,14,16,18,20,24,28,32].map(n=>`<option value="${n}">${n}</option>`).join('')}</select><span class="tb-group-label">Font</span>
      </div>
      <div class="tb-group" role="group" aria-label="Text formatting">
        <button type="button" data-cmd="bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button><button type="button" data-cmd="italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button><button type="button" data-cmd="underline" title="Underline (Ctrl/Cmd+U)"><u>U</u></button><button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        <button type="button" data-cmd="superscript" title="Superscript">x²</button><button type="button" data-cmd="subscript" title="Subscript">x₂</button><span class="tb-group-label">Text</span>
      </div>
      <div class="tb-group" role="group" aria-label="Text color and highlighting">
        ${colorPickerMarkup('tb-forecolor-picker','Text color','<b>A</b>')}
        ${colorPickerMarkup('tb-highlight-picker','Highlight color','<b>▰</b>',true)}
        <button type="button" data-cmd="removeFormat" aria-label="Clear formatting" title="Clear formatting"><span class="clear-format-icon">T<span>x</span></span></button><span class="tb-group-label">Color</span>
      </div>
      <div class="tb-group" role="group" aria-label="Paragraph style">
        <select id="tb-style" aria-label="Paragraph style"><option value="">Style ▾</option><option value="P">Normal</option><option value="H1">Heading 1</option><option value="H2">Heading 2</option><option value="H3">Heading 3</option><option value="BLOCKQUOTE">Quote</option></select><span class="tb-group-label">Styles</span>
      </div>
      <div class="tb-group" role="group" aria-label="Paragraph alignment">
        <button type="button" data-cmd="justifyLeft" aria-label="Align left" title="Align left">${ribbonIcon('alignLeft')}</button><button type="button" data-cmd="justifyCenter" aria-label="Center" title="Center">${ribbonIcon('alignCenter')}</button><button type="button" data-cmd="justifyRight" aria-label="Align right" title="Align right">${ribbonIcon('alignRight')}</button><button type="button" data-cmd="justifyFull" aria-label="Justify" title="Justify">${ribbonIcon('alignJustify')}</button><span class="tb-group-label">Paragraph</span>
      </div>
      <div class="tb-group" role="group" aria-label="Lists and indentation">
        <button type="button" data-cmd="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">${ribbonIcon('bullets')}</button><button type="button" data-cmd="insertOrderedList" aria-label="Numbered list" title="Numbered list">${ribbonIcon('numbers')}</button>
        <button type="button" data-cmd="outdent" aria-label="Decrease indent" title="Decrease indent">⇤</button><button type="button" data-cmd="indent" aria-label="Increase indent" title="Increase indent">⇥</button><span class="tb-group-label">Lists</span>
      </div>
      <div class="tb-group" role="group" aria-label="Line spacing">
        <select id="tb-linespacing" aria-label="Line spacing"><option value="1.4">Single</option><option value="1.6">1.15</option><option value="1.8">1.5</option><option value="2.2">Double</option></select><span class="tb-group-label">Spacing</span>
      </div>
      <div class="tb-group tb-group-tools" role="group" aria-label="Tools">
        <button type="button" id="delete-section" class="tb-del-btn" aria-label="Delete chapter" title="Delete current chapter">${ribbonIcon('trash')}<span>Delete</span></button><span class="tb-group-label">Tools</span>
      </div>
    </div>
  </div>
    <div contenteditable="true" id="content-editable" role="textbox" aria-multiline="true" aria-label="Manuscript chapter" style="line-height:${safeLineHeight(s.lineHeight)}">${sanitizeRichHtml(s.html||'<p></p>')}</div>`;
  /* Measure the sticky command bar and set --writer-bar-h so the title/toolbar offset is exact */
  requestAnimationFrame(() => {
    const cmdBar = document.querySelector('.write-workspace .writer-command-bar');
    if (cmdBar) {
      document.documentElement.style.setProperty('--writer-bar-h', cmdBar.offsetHeight + 'px');
    }
  });
  const titleInput = document.getElementById('title-input');
  let titleTimer = null;
  if(titleInput){
    titleInput.oninput = e => {
      s.title = e.target.value;
      const sel = document.getElementById('section-select');
      const opt = sel?.querySelector(`option[value="${s.id}"]`);
      if (opt) opt.textContent = `${s.title || 'Untitled'} (${s._wc !== undefined ? s._wc : (s._wc = wc(s.html || ''))}w)`;
      clearTimeout(titleTimer);
      titleTimer = setTimeout(() => {
        save();
        renderDocumentList();
      }, 500);
    };
    titleInput.onblur = () => {
      clearTimeout(titleTimer);
      save();
      renderSidebar();
    };
  }
  const editor=document.getElementById('content-editable');
  editor.oncontextmenu=event=>{event.preventDefault();showWriterContextPopover(editor,event)};
  editor.onkeydown=event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const range=window.getSelection()?.rangeCount?window.getSelection().getRangeAt(0):null,rect=range?.getBoundingClientRect()||editor.getBoundingClientRect();showWriterContextPopover(editor,{clientX:rect.left,clientY:rect.bottom})}};
  editor.onpaste=e=>{
    e.preventDefault();
    const html=e.clipboardData?.getData('text/html')||'';
    const plain=e.clipboardData?.getData('text/plain')||'';
    const safe=html?sanitizeRichHtml(html):plain.split(/\n{2,}/).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
    document.execCommand('insertHTML',false,safe||'<p></p>');
    setImportSafetyStatus('Pasted text was cleaned before it was added.','ok');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  editor.addEventListener('beforeinput', (event) => {
    if (!appSettings?.writing?.smartQuotes) return;
    if (event.isComposing) return;
    if (event.inputType?.startsWith('insertFromPaste') || event.inputType?.startsWith('insertFromDrop')) return;

    if (event.inputType === 'insertText' && event.data) {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!range.collapsed) return;

      const preRange = range.cloneRange();
      preRange.collapse(true);
      preRange.setStart(editor, 0);
      const preText = preRange.toString();
      const prevTwo = preText.slice(-2);
      const typed = event.data;

      if (typed === '"' || typed === "'") {
        const smart = smartenInput(prevTwo, typed);
        if (smart !== typed) {
          event.preventDefault();
          document.execCommand('insertText', false, smart);
        }
      } else if (typed === '-' && prevTwo.endsWith('-')) {
        event.preventDefault();
        document.execCommand('delete', false);
        document.execCommand('insertText', false, '—');
      } else if (typed === '.' && prevTwo.endsWith('..')) {
        event.preventDefault();
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, '…');
      }
    }
  });
  editor.oninput=()=>{
    writerDirty = true;
    updateUnsavedIndicator();
    if (!writerStatusTimer) {
      writerStatusTimer = setTimeout(() => {
        writerStatusTimer = null;
        updateWriterStatusFast(editor);
      }, 350);
    }
    clearTimeout(writerDebounceTimer);
    if (appSettings?.writing?.autosave !== false) {
      const delay = Math.max(500, Math.min(10000, Number(appSettings?.writing?.autosaveDelayMs) || 1500));
      writerDebounceTimer = setTimeout(() => {
        writerDebounceTimer = null;
        flushWriterSave();
      }, delay);
    }
    performTypewriterScroll();
  };
  editor.onkeyup=()=>{
    performTypewriterScroll();
  };
  editor.onblur=()=>{
    flushWriterSave();
  };
  applyWritingSettingsLive();
  updateWriterStatus();
  renderMetrics();
  document.getElementById('writer-save').onclick=saveWriter;
  document.getElementById('writer-status-save').onclick=saveWriter;
  const focusToggle=document.getElementById('writer-focus-toggle');focusToggle.setAttribute('aria-pressed',String(document.body.classList.contains('writer-focus')));focusToggle.onclick=()=>{const focused=document.body.classList.toggle('writer-focus');focusToggle.setAttribute('aria-pressed',String(focused))};
  const copyButton=document.getElementById('writer-copy'),pasteButton=document.getElementById('writer-paste');
  copyButton.onmousedown=pasteButton.onmousedown=event=>event.preventDefault();
  copyButton.onclick=copyWriterSelection;pasteButton.onclick=pasteIntoWriter;
  wrap.querySelectorAll('.toolbar [data-cmd]').forEach(b=>b.addEventListener('click',()=>cmd(b.dataset.cmd,b.dataset.value||null)));
  document.getElementById('tb-font').onchange=e=>{if(e.target.value)cmd('fontName',e.target.value);e.target.value=''};
  document.getElementById('tb-size').onchange=e=>{if(e.target.value)setFontSize(e.target.value);e.target.value=''};
  document.getElementById('tb-style').onchange=e=>{if(e.target.value)cmd('formatBlock',e.target.value);e.target.value=''};
  wrap.querySelectorAll('.tb-color-picker').forEach(picker=>{
    const trigger=picker.querySelector('.tb-color-trigger'),menu=picker.querySelector('.tb-color-menu'),editor=document.getElementById('content-editable');
    trigger.onpointerdown=event=>{event.preventDefault();const selection=window.getSelection();writerColorRange=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null};
    trigger.onclick=()=>{wrap.querySelectorAll('.tb-color-menu').forEach(other=>{if(other!==menu){other.hidden=true;other.parentElement.querySelector('.tb-color-trigger').setAttribute('aria-expanded','false')}});menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden))};
    menu.onpointerdown=event=>{if(event.target.closest('button'))event.preventDefault()};
    menu.onclick=event=>{
      const colorButton=event.target.closest('[data-palette-color]'),customButton=event.target.closest('[data-custom-color]'),clearButton=event.target.closest('[data-clear-highlight]');
      if(customButton){menu.querySelector('input[type="color"]').click();return}
      if(clearButton){applyWriterColor(editor,picker.dataset.colorKind,'transparent');menu.hidden=true;trigger.setAttribute('aria-expanded','false');return}
      if(colorButton){applyWriterColor(editor,picker.dataset.colorKind,colorButton.dataset.paletteColor);menu.hidden=true;trigger.setAttribute('aria-expanded','false')}
    };
    const customInput=menu.querySelector('input[type="color"]');customInput.oninput=()=>{applyWriterColor(editor,picker.dataset.colorKind,customInput.value);menu.hidden=true;trigger.setAttribute('aria-expanded','false')};
  });
  const lsSelect=document.getElementById('tb-linespacing');lsSelect.value=String(safeLineHeight(s.lineHeight));if(![...lsSelect.options].some(o=>o.value===lsSelect.value))lsSelect.value='1.4';
  lsSelect.onchange=e=>setLineSpacing(e.target.value);
  document.getElementById('delete-section').onclick=()=>delSection(s.id);
}
function addSection(){flushWriterSave();const id=Date.now();state.sections.push({id,title:'New Chapter',html:'<p></p>'});state.activeId=id;save();renderSidebar();renderEditor();renderHome();document.getElementById('title-input')?.focus()}
async function delSection(id){flushWriterSave();if(state.sections.length===1){toast("You can’t delete your only chapter.");return}const s=state.sections.find(item=>item.id===id);const title=s?.title?.trim()||'Untitled';const confirmed=await showConfirmDialog('Delete “'+title+'”?','Are you sure you want to delete this chapter? This cannot be undone.','Delete chapter');if(!confirmed)return;state.sections=state.sections.filter(s=>s.id!==id);state.activeId=state.sections[0].id;save();void flushOfflineSave().catch(()=>toast('Chapter deleted here, but the offline save needs attention.'));renderSidebar();renderEditor();renderHome();toast('Chapter deleted.')}

document.getElementById('add-section').addEventListener('click',addSection);
document.getElementById('create-blank-doc').addEventListener('click',createBlankDocument);
document.getElementById('write-back').addEventListener('click',showWriteLibrary);
function sortSectionsByTitle(){
  flushWriterSave();
  if(state.sections.length<=1){
    toast('At least 2 chapters are required to sort.');
    return;
  }
  state.sections.sort((a,b)=>compareChapterTitles(a.title||'',b.title||''));
  save();
  renderSidebar();
  renderDocumentList();
  renderEditor();
  toast('Chapters ordered in sequence by title.');
}
document.getElementById('sort-chapters-btn')?.addEventListener('click',sortSectionsByTitle);
document.getElementById('writer-sort-chapters-btn')?.addEventListener('click',sortSectionsByTitle);

async function importChapterFiles(rawFileList){
  const rawFiles=[...(rawFileList||[])];
  if(!rawFiles.length) return;
  if(rawFiles.length>50)toast('Choose up to 50 files at a time.');
  const files=rawFiles.sort((a,b)=>compareChapterTitles(a.name,b.name)).slice(0,50);
  let imported=0;
  const newSections=[];
  for(const file of files){try{
    const check=await screenImportFile(file);let html='';const name=file.name.replace(/\.(docx|pdf|txt)$/i,'').slice(0,120);
    if(check.ext==='docx'){if(!mammoth)throw new Error('Word importer unavailable.');const result=await mammoth.convertToHtml({arrayBuffer:check.bytes.buffer},{externalFileAccess:false});html=result.value||'<p></p>';if(result.messages?.some(m=>m.type==='warning'))check.notes.push('The document contains Word features that were skipped during import.')}
    else if(check.ext==='pdf'){
      const pdfTask=pdfjsLib.getDocument({data:check.bytes,cMapUrl:PDF_CMAP_URL,cMapPacked:true,standardFontDataUrl:PDF_STANDARD_FONT_URL,useWorkerFetch:false,useWasm:false,isEvalSupported:false,enableXfa:false});const doc=await pdfTask.promise;
      if(doc.numPages>1500){await pdfTask.destroy();throw new Error('This PDF has more than 1,500 pages. Please split it into smaller parts.')}const paras=[];let charTotal=0;
      try{for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent(),text=content.items.map(it=>it.str).join(' ');charTotal+=text.length;if(charTotal>3000000)throw new Error('This PDF has too much extracted text for one import. Split it into smaller parts.');paras.push('<p>'+escapeHtml(text)+'</p>')}}finally{await pdfTask.destroy()}
      html=paras.join('');check.notes.push('PDFs are imported as plain text; PDF scripts, links, forms, and attachments are not run or imported.');
    }else html=new TextDecoder('utf-8',{fatal:true}).decode(check.bytes).split(/\n\s*\n+/).map(p=>'<p>'+escapeHtml(p).replace(/\n/g,'<br>')+'</p>').join('');
    html=sanitizeRichHtml(html);const id=Date.now()+Math.floor(Math.random()*1000)+newSections.length;
    newSections.push({id,title:name,html,_wc:wc(html)});imported++;
    setImportSafetyStatus(`${file.name}: local checks passed. Unsafe formatting and active links were removed.${check.notes.length?' '+check.notes.join(' '):''}`,check.notes.length?'warning':'ok');
  }catch(err){const message=err?.message||'Could not safely check this file.';setImportSafetyStatus(`${file.name}: not imported. ${message}`,'error');toast('Import stopped: '+message);console.warn('Import safety check stopped a file:',file.name,message)}}

  if(newSections.length){
    newSections.sort((a,b)=>compareChapterTitles(a.title,b.title));
    const isSingleEmpty=state.sections.length===1&&!textOf(state.sections[0].html||'').trim()&&(state.sections[0].title==='Untitled'||!state.sections[0].title);
    if(isSingleEmpty){
      state.sections=newSections;
    }else{
      state.sections.push(...newSections);
      state.sections.sort((a,b)=>compareChapterTitles(a.title,b.title));
    }
    state.activeId=newSections[0].id;
    save();renderSidebar();renderEditor();renderHome();showWriteWorkspace();
    toast(`${imported} chapter${imported===1?'':'s'} ordered in sequence by title.`);
  }
}

document.getElementById('file-input').onchange=async e=>{
  await importChapterFiles(e.target.files);
  e.target.value='';
};
document.getElementById('template-file-input').onchange=async e=>{
  let added=0;const files=[...e.target.files].slice(0,12);
  for(const file of files){
    try{
      if(state.templates.length>=MAX_PROJECT_TEMPLATES)throw new Error(`A project can hold up to ${MAX_PROJECT_TEMPLATES} templates.`);
      const check=await screenImportFile(file);let html='',title=file.name.replace(/\.(docx|txt)$/i,'').trim().slice(0,120)||'Untitled template';
      if(check.ext==='docx'){
        if(!mammoth)throw new Error('Word importer unavailable.');
        const result=await mammoth.convertToHtml({arrayBuffer:check.bytes.buffer},{externalFileAccess:false});html=result.value||'<p></p>';
      }else html=new TextDecoder('utf-8',{fatal:true}).decode(check.bytes).split(/\n\s*\n+/).map(paragraph=>`<p>${escapeHtml(paragraph).replace(/\n/g,'<br>')}</p>`).join('');
      html=sanitizeRichHtml(html);
      if(html.length>MAX_TEMPLATE_HTML_CHARS)throw new Error('This template expands beyond the 2 MB template limit.');
      state.templates.push({id:newProjectId(),title,html,createdAt:new Date().toISOString()});added++;
    }catch(error){toast(`${file.name}: ${error?.message||'Could not safely add this template.'}`)}
  }
  if(added){save();renderTemplateLibrary();toast(`${added} template${added===1?'':'s'} added to this project.`)}
  e.target.value='';
};

const STOPWORDS=new Set(['The','A','An','I','He','She','They','We','It','You','Us','Them','Its','Your','Yours','Yourself','Our','Ours','Ourselves','Themselves','Himself','Herself','Myself','Someone','Somebody','Something','Somewhere','Somehow','Anyone','Anybody','Anything','Anywhere','Everyone','Everybody','Everything','Everywhere','Nothing','Nobody','Nowhere','None','But','And','Or','Nor','So','Yet','If','When','Then','Than','There','Here','This','That','These','Those','His','Her','Their','Because','Although','Though','While','Since','Unless','Until','After','Before','Above','Below','Between','Among','Beyond','Within','Without','Through','Across','Around','Toward','Towards','During','Despite','Perhaps','Suddenly','Meanwhile','Normally','However','Instead','Otherwise','Still','Also','Even','Just','Now','Soon','Later','Finally','Eventually','Indeed','Certainly','Probably','Maybe','Well','Oh','Ah','Yes','No','Okay','Alright','Sure','Right','Look','Listen','Wait','Stop','Come','Go','Let','Once','Again','Almost','Already','Always','Never','Every','Each','Both','Few','Many','Most','Some','All','Any','Can','Could','Would','Should','Will','Shall','Must','May','Might','Do','Does','Did','Am','Is','Are','Was','Were','Being','Been','Have','Has','Had','Sorry','Please','Thanks','Thank','Hello','Hi','Hey','Goodbye','Bye','Congratulations','Welcome','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','January','February','March','April','May','June','July','August','September','October','November','December','Chapter','Prologue','Epilogue','Part','St','War','World','Grind','Civilization','Civilizations','Daily','Ankhor','Proth','Onos','Uth']);
['Who','Whom','Whose','What','Where','Which','Why','How'].forEach(word=>STOPWORDS.add(word));
const COMMON_ENGLISH=new Set(['the','of','and','a','to','in','is','was','he','for','it','with','as','his','on','be','at','by','i','this','had','not','are','but','from','or','have','an','they','which','one','you','were','her','all','she','there','would','their','we','him','been','has','when','who','will','more','no','if','out','so','said','what','up','its','about','into','than','them','can','only','other','new','some','could','time','these','two','may','then','do','first','any','my','now','such','like','our','over','me','even','most','made','after','also','did','many','before','must','through','back','where','much','your','way','well','down','should','because','each','just','those','how','too','little','very','make','still','own','see','work','long','here','get','both','between','know','while','last','might','us','old','year','come','right','used','take']);
function sectionLooksNonEnglish(html){
  const words=(textOf(html).match(/[A-Za-z']+/g)||[]);
  if(words.length<20)return false; // too short to judge fairly — assume English
  let hits=0;words.forEach(w=>{if(COMMON_ENGLISH.has(w.toLowerCase()))hits++});
  return (hits/words.length)<0.08; // English prose is thick with function words; foreign text won't clear this bar
}
function detectCharacters(){
  try {
    const sensitivity = appSettings?.writing?.recogniserSensitivity || 'balanced';
    const recognitionConfig = getCharacterRecognitionConfig(sensitivity);
    const chapters = (state?.sections || []).map(s => ({
      id: s.id,
      title: s.title || 'Untitled',
      text: textOf(s.html || ''),
    }));
    const recognized = recognizeCharacters(chapters, recognitionConfig).filter(candidate => candidate.count >= 2 && (candidate.score >= recognitionConfig.threshold || state.charConfirmed?.[candidate.name]));
    if (recognized.length > 0) {
      const candidateEntries = recognized.map(c => {
        const aliasList = Array.isArray(c.aliases) && c.aliases.length > 0
          ? c.aliases
          : (c.parts && c.parts.length > 1 ? c.parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()) : undefined);
        return [
          c.name,
          {
            count: c.count,
            sections: c.sectionTitles instanceof Set ? c.sectionTitles : new Set(Array.isArray(c.sectionTitles) ? c.sectionTitles : []),
            sectionCounts: c.sectionCounts instanceof Map ? c.sectionCounts : new Map(),
            aliases: aliasList,
          }
        ];
      });
      const merged = applyCharMerges(candidateEntries.filter(([n]) => !state.charIgnore?.[n]));
      return merged.sort((a, b) => b[1].count - a[1].count);
    }
  } catch (err) {
    console.warn('Advanced character recognition error, falling back:', err);
  }
  const sections = Array.isArray(state?.sections) ? state.sections : [];
  const nonEnglish=new Set();sections.forEach(s=>{if(sectionLooksNonEnglish(s.html||''))nonEnglish.add(s.id)});
  const scanSections=sections.filter(s=>!nonEnglish.has(s.id));
  const lowerSeen=new Set();scanSections.forEach(s=>{const plain=textOf(s.html||'').replace(/\n+/g,'. ');(plain.match(/[A-Za-z']+/g)||[]).forEach(w=>{if(/^[a-z][a-z']{2,}$/.test(w))lowerSeen.add(w)})});
  const solo={},bigrams={};scanSections.forEach(s=>{const plain=textOf(s.html||'').replace(/\n+/g,'. '),tokens=plain.match(/[A-Za-z']+|[.!?,;]|["“”:]/g)||[];let atStart=true,prevWord='',prevCand=null;const seenSolo=new Set(),seenBig=new Set();
    tokens.forEach(tok=>{if(tok===','||tok===';'){prevCand=null;return}if(tok==='.'||tok==='!'||tok==='?'||tok==='"'||tok==='“'||tok==='”'||tok===':'){atStart=true;prevCand=null;return}
      const isCand=/^[A-Z][a-z]{2,}$/.test(tok)&&!STOPWORDS.has(tok)&&!lowerSeen.has(tok.toLowerCase());
      if(isCand){if(!solo[tok])solo[tok]={count:0,sections:new Set(),midHits:0,afterDeterminer:0};solo[tok].count++;if(!atStart)solo[tok].midHits++;if(prevWord==='the'||prevWord==='a'||prevWord==='an')solo[tok].afterDeterminer++;seenSolo.add(tok);
        if(prevCand){const key=prevCand+' '+tok;if(!bigrams[key])bigrams[key]={count:0,sections:new Set(),first:prevCand,last:tok};bigrams[key].count++;seenBig.add(key)}
        prevCand=tok
      } else {prevCand=null}
      prevWord=tok.toLowerCase();atStart=false});
    seenSolo.forEach(w=>solo[w].sections.add(s.title||'Untitled'));seenBig.forEach(k=>bigrams[k].sections.add(s.title||'Untitled'));
  });
  const used=new Set(),results=[];
  Object.values(bigrams).forEach(b=>{const fc=solo[b.first]?solo[b.first].count:b.count,lc=solo[b.last]?solo[b.last].count:b.count,total=Math.max(fc+lc-b.count,b.count);if(total<2)return;const sections=new Set(b.sections);if(solo[b.first])solo[b.first].sections.forEach(x=>sections.add(x));if(solo[b.last])solo[b.last].sections.forEach(x=>sections.add(x));results.push([b.first+' '+b.last,{count:total,sections,aliases:[b.first,b.last]}]);used.add(b.first);used.add(b.last)});
  Object.entries(solo).forEach(([w,d])=>{if(used.has(w))return;if(d.count<2||d.midHits<1)return;if(d.afterDeterminer/d.count>.4)return;results.push([w,{count:d.count,sections:d.sections}])});
  const merged=applyCharMerges(results.filter(([n])=>!state.charIgnore?.[n]));
  return merged.sort((a,b)=>b[1].count-a[1].count);
}
function detectCharacterReview(){
  try{
    const sensitivity=appSettings?.writing?.recogniserSensitivity||'balanced',config=getCharacterRecognitionConfig(sensitivity);
    const chapters=(state?.sections||[]).map(s=>({id:s.id,title:s.title||'Untitled',text:textOf(s.html||'')}));
    return recognizeCharacters(chapters,config,{minScore:Math.max(2.4,config.threshold*.48)})
      .filter(candidate=>candidate.count>=2&&candidate.score<config.threshold&&!state.charReviewResolved?.[candidate.name]&&!state.charConfirmed?.[candidate.name]&&!state.charIgnore?.[candidate.name]&&!state.charMerge?.[candidate.name])
      .map(candidate=>({name:candidate.name,count:candidate.count,score:candidate.score,confidence:candidate.confidence,reasons:candidate.reasons||[],sections:candidate.sectionTitles instanceof Set?candidate.sectionTitles:new Set(),sectionCounts:candidate.sectionCounts instanceof Map?candidate.sectionCounts:new Map(),aliases:candidate.aliases||[]}));
  }catch(error){console.warn('Character review scan failed:',error);return []}
}
function resolveMergeTarget(name,map,seen){seen=seen||new Set();if(seen.has(name))return name;seen.add(name);return map[name]?resolveMergeTarget(map[name],map,seen):name}
function applyCharMerges(results){
  const map=state.charMerge||{};
  if(!Object.keys(map).length)return results;
  const grouped={};
  results.forEach(([name,d])=>{
    const canonical=resolveMergeTarget(name,map);
    if(!grouped[canonical])grouped[canonical]={count:0,sections:new Set(),aliasSet:new Set()};
    grouped[canonical].count+=d.count;
    if (d.sections instanceof Set || Array.isArray(d.sections)) {
      d.sections.forEach(x=>grouped[canonical].sections.add(x));
    }
    if(d.sectionCounts instanceof Map){if(!grouped[canonical].sectionCounts)grouped[canonical].sectionCounts=new Map();d.sectionCounts.forEach((count,id)=>grouped[canonical].sectionCounts.set(id,(grouped[canonical].sectionCounts.get(id)||0)+count))}
    if(name!==canonical)grouped[canonical].aliasSet.add(name);
    (d.aliases||[]).forEach(a=>grouped[canonical].aliasSet.add(a));
  });
  return Object.entries(grouped).map(([name,d])=>[name,{count:d.count,sections:d.sections,sectionCounts:d.sectionCounts||new Map(),aliases:d.aliasSet.size?[...d.aliasSet]:undefined}]);
}
  function ignoreCharacter(name){state.charIgnore=state.charIgnore||{};state.charReviewResolved=state.charReviewResolved||{};state.charIgnore[name]=true;state.charReviewResolved[name]='ignored';save();renderCharacters();renderWeb();renderMetrics()}
  function restoreIgnoredCharacters(){state.charIgnore={};save();renderCharacters();renderWeb();renderMetrics()}
  function mergeCharacter(name,target){if(!target||target===name)return;state.charMerge=state.charMerge||{};state.charReviewResolved=state.charReviewResolved||{};state.charMerge[name]=target;state.charReviewResolved[name]='merged';save();renderCharacters();renderWeb();renderMetrics()}
function characterProfile(name){state.charProfiles=state.charProfiles||{};const profile=state.charProfiles[name]||{};return {...profile,aliases:Array.isArray(profile.aliases)?profile.aliases:[],role:profile.role||'Unassigned',notes:profile.notes||state.charNotes?.[name]||''}}
function characterTone(name){let hash=0;for(const char of name)hash=(hash*31+char.charCodeAt(0))>>>0;return hash%6}
function chapterMentionCount(data,chapter){const map=data.sectionCounts;if(map instanceof Map){const direct=map.get(chapter.id)??map.get(String(chapter.id));if(Number.isFinite(direct))return direct}const sections=data.sections instanceof Set?[...data.sections]:Array.isArray(data.sections)?data.sections:[];return sections.includes(chapter.title||'Untitled')?1:0}
function characterRows(){
  const chars=detectCharacters()||[];const max=Math.max(1,...chars.map(([,d])=>d.count||0));
  return chars.map(([name,data])=>{const profile=characterProfile(name),chapters=state.sections.map((chapter,index)=>({chapter,index,count:chapterMentionCount(data,chapter)})),first=chapters.find(item=>item.count>0),sections=new Set(chapters.filter(item=>item.count>0).map(item=>item.chapter.title||'Untitled'));const aliases=[...new Set([...(Array.isArray(data.aliases)?data.aliases:[]),...profile.aliases].filter(alias=>alias&&alias.toLowerCase()!==name.toLowerCase()))];const oftenWith=chars.filter(([other,otherData])=>other!==name&&state.sections.reduce((sum,chapter)=>sum+(chapterMentionCount(data,chapter)>0&&chapterMentionCount(otherData,chapter)>0?1:0),0)>0).map(([other])=>other).slice(0,3);return {name,data,profile,chapters,first,sections,aliases,oftenWith,tier:(data.count||0)>=max*.45?'main':(data.count||0)>=max*.12?'supporting':'minor',late:first&&first.index>=Math.max(2,state.sections.length-3)}})
}
function saveCharacterProfile(name,profile){state.charProfiles=state.charProfiles||{};state.charProfiles[name]={role:profile.role||'Unassigned',description:profile.description||'',aliases:Array.isArray(profile.aliases)?profile.aliases:[],relationships:profile.relationships||'',notes:profile.notes||''};state.charNotes[name]=profile.notes||'';save();renderCharacters();renderHome();renderWeb()}
function jumpToCharacterChapter(name,chapterId){const chapter=state.sections.find(item=>String(item.id)===String(chapterId));if(!chapter)return;switchView('write');openSection(chapter.id);toast(`Opened ${chapter.title||'chapter'} for ${name}.`)}
function openCharacterSheet(name,focus=''){
  const modal=document.getElementById('character-sheet'),row=characterRows().find(item=>item.name===name);if(!modal||!row)return;const profile=row.profile;modal.dataset.character=name;modal.querySelector('#character-sheet-title').textContent=name;modal.querySelector('#char-sheet-name').value=name;modal.querySelector('#char-sheet-role').value=profile.role;modal.querySelector('#char-sheet-description').value=profile.description||'';modal.querySelector('#char-sheet-aliases').value=row.aliases.join(', ');modal.querySelector('#char-sheet-first').textContent=row.first?`${row.first.chapter.title||'Untitled'} · ${row.first.count} mention${row.first.count===1?'':'s'}`:'Not found';modal.querySelector('#char-sheet-relationships').value=profile.relationships||row.oftenWith.join(', ');modal.querySelector('#char-sheet-notes').value=profile.notes||'';const mergeSelect=modal.querySelector('#char-sheet-merge');mergeSelect.innerHTML='<option value="">Choose a character…</option>'+characterRows().filter(item=>item.name!==name).map(item=>`<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');modal.hidden=false;requestAnimationFrame(()=>modal.querySelector(focus?`#char-sheet-${focus}`:'#char-sheet-name')?.focus())
}
function closeCharacterSheet(){const modal=document.getElementById('character-sheet');if(modal)modal.hidden=true}
function saveCharacterSheet(){const modal=document.getElementById('character-sheet');if(!modal)return;const oldName=modal.dataset.character,newName=modal.querySelector('#char-sheet-name').value.trim().slice(0,120);if(!newName){toast('Give this character a name first.');return}const profile={role:modal.querySelector('#char-sheet-role').value,description:modal.querySelector('#char-sheet-description').value.trim(),aliases:modal.querySelector('#char-sheet-aliases').value.split(',').map(value=>value.trim()).filter(Boolean).slice(0,20),relationships:modal.querySelector('#char-sheet-relationships').value.trim(),notes:modal.querySelector('#char-sheet-notes').value.trim()};if(newName!==oldName){state.charMerge=state.charMerge||{};state.charMerge[oldName]=newName;state.charProfiles[newName]=profile;delete state.charProfiles[oldName];if(state.charNotes?.[oldName]){state.charNotes[newName]=state.charNotes[oldName];delete state.charNotes[oldName]}}else saveCharacterProfile(oldName,profile);if(newName!==oldName){save();renderCharacters();renderHome();renderWeb()}closeCharacterSheet()}
function confirmReviewCandidate(name){state.charConfirmed=state.charConfirmed||{};state.charReviewResolved=state.charReviewResolved||{};state.charConfirmed[name]=true;state.charReviewResolved[name]='confirmed';save();renderCharacters();renderHome();renderWeb();renderMetrics();toast(`${name} added to the character roster.`)}
function renderCharacters(){
  try{
    state.charNotes=state.charNotes||{};state.charProfiles=state.charProfiles||{};state.charIgnore=state.charIgnore||{};state.charMerge=state.charMerge||{};const grid=document.getElementById('char-grid'),reviewTray=document.getElementById('character-review-tray');if(!grid)return;let rows=characterRows(),review=detectCharacterReview();const search=(document.getElementById('character-search')?.value||'').trim().toLowerCase(),sort=document.getElementById('character-sort')?.value||'mentions',layout=document.getElementById('character-layout')?.value||'grid';if(search)rows=rows.filter(row=>[row.name,...row.aliases].join(' ').toLowerCase().includes(search));rows.sort((a,b)=>sort==='az'?a.name.localeCompare(b.name):sort==='first'?(a.first?.index??9999)-(b.first?.index??9999):b.data.count-a.data.count);if(reviewTray){reviewTray.hidden=!review.length;reviewTray.innerHTML=review.length?`<div class="review-tray-heading"><div><strong>To review</strong><span>${review.length} uncertain candidate${review.length===1?'':'s'}</span></div><small>Confirm, dismiss, or merge these before they enter the roster.</small></div><div class="review-tray-list">${review.slice(0,12).map(candidate=>`<article class="review-candidate"><div><strong>${escapeHtml(candidate.name)}</strong><small>${candidate.count} mentions · ${escapeHtml(candidate.reasons.slice(0,2).join(' · ')||'Low-confidence candidate')}</small></div><div class="review-candidate-actions"><button type="button" class="secondary-button" data-review-confirm="${escapeHtml(candidate.name)}">Confirm</button><button type="button" class="secondary-button" data-review-ignore="${escapeHtml(candidate.name)}">Not a character</button><select data-review-merge="${escapeHtml(candidate.name)}" aria-label="Merge ${escapeHtml(candidate.name)}"><option value="">Merge with…</option>${rows.map(row=>`<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)}</option>`).join('')}</select></div></article>`).join('')}</div>`:''}
    grid.classList.toggle('char-list-layout',layout==='list');if(!rows.length){grid.innerHTML='<div class="empty">No recurring characters match this view. Run Scan manuscript or adjust the filter.</div>';return}const groups=['main','supporting','minor'];grid.innerHTML=groups.map(tier=>{const group=rows.filter(row=>row.tier===tier);if(!group.length)return '';return `<section class="character-tier character-tier-${tier}"><header><h3>${tier==='main'?'Main':tier==='supporting'?'Supporting':'Minor'}</h3><span>${group.length}</span></header><div class="character-card-grid">${group.map(row=>{const monogram=row.name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase(),maxMention=Math.max(1,...row.chapters.map(item=>item.count)),aliases=row.aliases.slice(0,3),notes=row.profile.notes.replace(/\s+/g,' ').trim(),firstLabel=row.first?`New in ${row.first.chapter.title||'chapter'}`:'',chapters=row.chapters.map(item=>`<button type="button" class="appearance-cell ${item.count?'has-mentions':''}" style="--appearance:${Math.max(.18,item.count/maxMention)}" title="${escapeHtml(`${item.chapter.title||'Chapter '+(item.index+1)}: ${item.count} mention${item.count===1?'':'s'}`)}" aria-label="${escapeHtml(`${item.chapter.title||'Chapter '+(item.index+1)}: ${item.count} mentions`)}" data-character-chapter="${escapeHtml(row.name)}" data-chapter-id="${escapeHtml(String(item.chapter.id))}"></button>`).join('');return `<article class="char-card char-card-${row.tier}" data-character-card="${escapeHtml(row.name)}"><div class="char-card-main" role="button" tabindex="0" data-character-open="${escapeHtml(row.name)}"><div class="char-card-top"><span class="char-monogram tone-${characterTone(row.name)}">${escapeHtml(monogram)}</span><span class="char-card-heading"><strong>${escapeHtml(row.name)}</strong><span class="char-role-chip">${escapeHtml(row.profile.role)}</span></span>${row.late?`<span class="char-late-badge">${escapeHtml(firstLabel)}</span>`:''}</div><div class="char-count"><b>${(row.data.count||0).toLocaleString()}</b><span>mentions</span></div><div class="appearance-strip" aria-label="Chapter appearances">${chapters}</div><div class="char-alias-slot">${aliases.length?aliases.map(alias=>`<span class="char-chip">${escapeHtml(alias)}</span>`).join(''):'<span class="char-muted">No aliases yet</span>'}</div><p class="char-note-preview">${escapeHtml(notes||'Add a description or note in the character sheet.')}</p><p class="char-often-with">${row.oftenWith.length?`Often with: ${row.oftenWith.map(escapeHtml).join(', ')}`:'No frequent co-appearances yet'}</p></div><div class="char-card-footer"><button type="button" class="char-menu-button" aria-label="More actions for ${escapeHtml(row.name)}" aria-expanded="false" data-character-menu="${escapeHtml(row.name)}">⋯</button><div class="char-menu" hidden>${[['Rename','rename'],['Add alias','alias']].map(([label,action])=>`<button type="button" data-character-action="${action}" data-character-name="${escapeHtml(row.name)}">${label}</button>`).join('')}<button type="button" data-character-action="merge" data-character-name="${escapeHtml(row.name)}">Merge with…</button><button type="button" data-character-action="ignore" data-character-name="${escapeHtml(row.name)}">Not a character</button><button type="button" data-character-action="story-web" data-character-name="${escapeHtml(row.name)}">Open in Story Web</button><button type="button" data-character-action="first" data-character-name="${escapeHtml(row.name)}">Jump to first mention</button></div></div></article>`}).join('')}</div></section>`}).join('');
    grid.querySelectorAll('[data-character-open]').forEach(button=>{button.addEventListener('click',()=>openCharacterSheet(button.dataset.characterOpen));button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCharacterSheet(button.dataset.characterOpen)}})});grid.querySelectorAll('[data-character-chapter]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();jumpToCharacterChapter(button.dataset.characterChapter,button.dataset.chapterId)}));grid.querySelectorAll('[data-character-menu]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const menu=button.parentElement.querySelector('.char-menu');const open=!menu.hidden;grid.querySelectorAll('.char-menu').forEach(item=>item.hidden=true);grid.querySelectorAll('[data-character-menu]').forEach(item=>item.setAttribute('aria-expanded','false'));menu.hidden=open;button.setAttribute('aria-expanded',String(!open))}));grid.querySelectorAll('[data-character-action]').forEach(button=>button.addEventListener('click',()=>{const name=button.dataset.characterName,action=button.dataset.characterAction;if(action==='rename')openCharacterSheet(name);if(action==='alias')openCharacterSheet(name,'aliases');if(action==='ignore')ignoreCharacter(name);if(action==='merge')openCharacterSheet(name,'merge');if(action==='story-web')switchView('web');if(action==='first'){const row=rows.find(item=>item.name===name);if(row?.first)jumpToCharacterChapter(name,row.first.chapter.id)}}));reviewTray?.querySelectorAll('[data-review-confirm]').forEach(button=>button.addEventListener('click',()=>confirmReviewCandidate(button.dataset.reviewConfirm)));reviewTray?.querySelectorAll('[data-review-ignore]').forEach(button=>button.addEventListener('click',()=>ignoreCharacter(button.dataset.reviewIgnore)));reviewTray?.querySelectorAll('[data-review-merge]').forEach(select=>select.addEventListener('change',event=>{if(event.target.value)mergeCharacter(select.dataset.reviewMerge,event.target.value)}));
  }catch(error){console.error('Characters tab rendering error:',error);const grid=document.getElementById('char-grid');if(grid)grid.innerHTML=`<div class="empty">Unable to display characters: ${escapeHtml(error?.message||'Unexpected error')}.</div>`}
}
async function scanCharacters(){const button=document.getElementById('btn-scan-characters'),status=document.getElementById('character-scan-status'),progress=document.getElementById('character-scan-progress'),fill=document.getElementById('character-scan-progress-fill');if(!button||button.disabled)return;flushWriterSave();button.disabled=true;button.classList.add('is-scanning');if(progress)progress.hidden=false;if(fill)fill.style.width='8%';if(status)status.textContent=`Scanning ${state.sections.length} ${state.sections.length===1?'chapter':'chapters'} offline…`;await new Promise(resolve=>setTimeout(resolve,120));try{if(fill)fill.style.width='48%';await new Promise(resolve=>setTimeout(resolve,180));const characters=detectCharacters();if(fill)fill.style.width='82%';renderCharacters();renderHome();renderWeb();renderMetrics();if(fill)fill.style.width='100%';if(status)status.textContent=`Scanned just now · ${characters.length} character${characters.length===1?'':'s'} found`;toast(`Manuscript scan complete: ${characters.length} characters found.`)}catch(error){console.error('Character scan failed:',error);if(status)status.textContent='Scan could not be completed.';toast('Character scan failed: '+error.message)}finally{button.disabled=false;button.classList.remove('is-scanning');setTimeout(()=>{if(progress)progress.hidden=true;if(fill)fill.style.width='0%'},500)}}
let webViewport={x:0,y:0,scale:1,initialized:false},webSelectedNode='',webPendingOutput='';
window.addEventListener('resize',()=>{if(document.getElementById('view-web').classList.contains('active')){webViewport.initialized=false;renderWeb()}});
function renderWeb(){
  const svg=document.getElementById('webcanvas'),empty=document.getElementById('web-empty'),selection=document.getElementById('web-selection'),wrap=document.querySelector('.node-graph-wrap');
  if(!svg||!wrap)return;
  const characters=detectCharacters(),chapters=state.sections,ns='http://www.w3.org/2000/svg';
  state.webPositions=state.webPositions||{};state.webLinks=Array.isArray(state.webLinks)?state.webLinks:[];state.webNodes=Array.isArray(state.webNodes)?state.webNodes:[];
  const migratedLayout=state.webLayoutVersion!==2;if(migratedLayout){state.webPositions={};state.webLayoutVersion=2;}
  svg.hidden=false;empty.hidden=characters.length>0;empty.textContent='No recurring characters detected yet. Story and chapter nodes are still shown.';svg.innerHTML='';
  const bounds=wrap.getBoundingClientRect(),mapVisible=document.getElementById('view-web').classList.contains('active')&&bounds.width>0,width=Math.max(320,Math.round(bounds.width)),height=Math.max(360,Math.round(bounds.height));
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('preserveAspectRatio','none');
  const nodes=[{key:'story-root',type:'story',label:projects.find(project=>String(project.id)===String(activeProjectId))?.name||'Story',detail:'MANUSCRIPT',width:176,height:58,defaultX:92,defaultY:120+(chapters.length-1)*66}];
  chapters.forEach((chapter,index)=>nodes.push({key:`chapter:${chapter.id}`,type:'chapter',label:chapter.title||'Untitled chapter',detail:`${wc(chapter.html||'').toLocaleString()} words`,width:176,height:58,defaultX:390,defaultY:120+index*132,section:chapter}));
  characters.forEach(([name,data],index)=>{
    const inSection = (chapter) => data.sections instanceof Set ? data.sections.has(chapter.title||'Untitled') : (Array.isArray(data.sections) && data.sections.includes(chapter.title||'Untitled'));
    const linked=chapters.filter(inSection),defaultY=linked.length?linked.reduce((total,chapter)=>total+120+chapters.indexOf(chapter)*132,0)/linked.length:150+index*96;
    nodes.push({key:`character:${name}`,type:'character',label:name,detail:`${data.count} mentions`,width:176,height:58,defaultX:700,defaultY,character:data});
  });
  state.webNodes.forEach((custom,index)=>nodes.push({key:`custom:${custom.id}`,type:custom.type,label:custom.label,detail:custom.type.toUpperCase(),width:176,height:58,defaultX:1010+Math.floor(index/9)*260,defaultY:120+(index%9)*96,custom}));
  nodes.forEach(node=>{const saved=state.webPositions[node.key];node.x=Number.isFinite(saved?.x)?saved.x:node.defaultX;node.y=Number.isFinite(saved?.y)?saved.y:node.defaultY});
  const category=document.getElementById('web-category')?.value||'all',status=document.getElementById('web-status')?.value||'all';
  const visible=nodes.filter(node=>(category==='all'||(category==='story'&&['story','chapter'].includes(node.type))||node.type===category)&&(status==='all'||(node.type==='character'&&(state.charStatus?.[node.label]||'unknown')===status)));
  const visibleByKey=new Map(visible.map(node=>[node.key,node])),connections=[];
  chapters.forEach(chapter=>connections.push([`story-root`,`chapter:${chapter.id}`]));
  characters.forEach(([name,data])=>chapters.forEach(chapter=>{
    const hasSec = data.sections instanceof Set ? data.sections.has(chapter.title||'Untitled') : (Array.isArray(data.sections) && data.sections.includes(chapter.title||'Untitled'));
    if(hasSec)connections.push([`chapter:${chapter.id}`,`character:${name}`]);
  }));
  state.webLinks.forEach(link=>{if(link&&typeof link.from==='string'&&typeof link.to==='string')connections.push([link.from,link.to])});
  const uniqueLinks=[...new Map(connections.filter(([from,to])=>from!==to&&visibleByKey.has(from)&&visibleByKey.has(to)).map(pair=>[pair.join('\u0000'),pair])).values()];
  const defs=document.createElementNS(ns,'defs'),pattern=document.createElementNS(ns,'pattern'),gridPath=document.createElementNS(ns,'path');
  pattern.setAttribute('id','web-grid');pattern.setAttribute('width','36');pattern.setAttribute('height','36');pattern.setAttribute('patternUnits','userSpaceOnUse');gridPath.setAttribute('d','M 36 0 L 0 0 0 36');gridPath.setAttribute('fill','none');gridPath.setAttribute('stroke','#2a302e');gridPath.setAttribute('stroke-width','1');pattern.appendChild(gridPath);defs.appendChild(pattern);svg.appendChild(defs);
  const background=document.createElementNS(ns,'rect');background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','#191d1c');background.setAttribute('fill-opacity','0');background.dataset.mapBackground='true';svg.appendChild(background);
  const world=document.createElementNS(ns,'g');world.setAttribute('class','web-world');world.setAttribute('transform',`translate(${webViewport.x} ${webViewport.y}) scale(${webViewport.scale})`);svg.appendChild(world);
  const grid=document.createElementNS(ns,'rect');grid.setAttribute('x',-webViewport.x/webViewport.scale);grid.setAttribute('y',-webViewport.y/webViewport.scale);grid.setAttribute('width',width/webViewport.scale);grid.setAttribute('height',height/webViewport.scale);grid.setAttribute('fill','url(#web-grid)');grid.setAttribute('pointer-events','none');world.appendChild(grid);
  const edgeLayer=document.createElementNS(ns,'g');edgeLayer.setAttribute('class','web-edges');world.appendChild(edgeLayer);
  const edgePaths=[];
  const drawEdge=(fromKey,toKey)=>{
    const from=visibleByKey.get(fromKey),to=visibleByKey.get(toKey);if(!from||!to)return;
    const path=document.createElementNS(ns,'path'),startX=from.x+from.width,startY=from.y+39,endX=to.x,endY=to.y+39,curve=Math.max(50,Math.abs(endX-startX)*.48);
    path.setAttribute('d',`M ${startX} ${startY} C ${startX+curve} ${startY}, ${endX-curve} ${endY}, ${endX} ${endY}`);path.setAttribute('fill','none');path.setAttribute('stroke',from.type==='chapter'?'#69b4d5':'#57bd80');path.setAttribute('stroke-width','2');path.setAttribute('opacity','.88');path.dataset.from=fromKey;path.dataset.to=toKey;edgeLayer.appendChild(path);edgePaths.push(path);
  };
  uniqueLinks.forEach(([from,to])=>drawEdge(from,to));
  const nodeLayer=document.createElementNS(ns,'g');nodeLayer.setAttribute('class','web-nodes');world.appendChild(nodeLayer);
  const updateEdges=()=>edgePaths.forEach(path=>{
    const from=visibleByKey.get(path.dataset.from),to=visibleByKey.get(path.dataset.to);if(!from||!to)return;
    const startX=from.x+from.width,startY=from.y+39,endX=to.x,endY=to.y+39,curve=Math.max(50,Math.abs(endX-startX)*.48);path.setAttribute('d',`M ${startX} ${startY} C ${startX+curve} ${startY}, ${endX-curve} ${endY}, ${endX} ${endY}`);
  });
  const updateTransform=()=>{world.setAttribute('transform',`translate(${webViewport.x} ${webViewport.y}) scale(${webViewport.scale})`);document.getElementById('web-zoom-level').textContent=`${Math.round(webViewport.scale*100)}%`};
  const selectNode=node=>{
    webSelectedNode=node.key;const remove=document.getElementById('web-remove-node');if(remove)remove.disabled=!node.custom;
    if(selection)selection.textContent=node.type==='character'?`${node.label} · ${node.detail} · Appears in ${[...node.character.sections].join(', ')}`:node.type==='chapter'?`${node.label} · ${node.detail}`:node.custom?`${node.label} · ${node.detail}`:`${node.label} · manuscript root`;
  };
  visible.forEach(node=>{
    const group=document.createElementNS(ns,'g');group.dataset.nodeKey=node.key;group.setAttribute('transform',`translate(${node.x} ${node.y})`);group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label',`${node.type}: ${node.label}, ${node.detail}`);group.style.cursor='grab';
    const header=document.createElementNS(ns,'rect'),body=document.createElementNS(ns,'rect'),title=document.createElementNS(ns,'text'),detail=document.createElementNS(ns,'text');
    const headerColor=node.type==='chapter'?'#3d6988':node.type==='character'?'#48534e':'#34784f';
    header.setAttribute('x','0');header.setAttribute('y','0');header.setAttribute('width',node.width);header.setAttribute('height','25');header.setAttribute('rx','4');header.setAttribute('fill',headerColor);
    body.setAttribute('x','0');body.setAttribute('y','20');body.setAttribute('width',node.width);body.setAttribute('height','38');body.setAttribute('rx','3');body.setAttribute('fill','#353a38');body.setAttribute('stroke','#49504d');body.setAttribute('stroke-width','1');
    title.setAttribute('x',node.width/2);title.setAttribute('y','17');title.setAttribute('text-anchor','middle');title.setAttribute('font-size','12');title.setAttribute('font-weight','600');title.setAttribute('fill','#f4f6f4');title.setAttribute('font-family','-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif');title.textContent=node.label.length>26?node.label.slice(0,24)+'…':node.label;
    detail.setAttribute('x',node.width/2);detail.setAttribute('y','43');detail.setAttribute('text-anchor','middle');detail.setAttribute('font-size','10');detail.setAttribute('fill','#c2cbc5');detail.setAttribute('font-family','-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif');detail.textContent=node.detail;
    group.append(header,body,title,detail);
    const makePort=(side,label)=>{
      const port=document.createElementNS(ns,'circle');port.setAttribute('cx',side==='out'?node.width:0);port.setAttribute('cy','39');port.setAttribute('r','5');port.setAttribute('fill','#1b211e');port.setAttribute('stroke','#76cf99');port.setAttribute('stroke-width','2');port.setAttribute('data-port',side);port.setAttribute('aria-label',`${label} ${node.label}`);port.style.cursor='crosshair';group.appendChild(port);
      port.addEventListener('click',event=>{event.stopPropagation();if(side==='out'){webPendingOutput=node.key;if(selection)selection.textContent=`Output selected: ${node.label}. Choose an input port.`;return}if(!webPendingOutput||webPendingOutput===node.key){if(selection)selection.textContent='Choose an output port first, then an input port.';return}if(!state.webLinks.some(link=>link.from===webPendingOutput&&link.to===node.key)){state.webLinks.push({from:webPendingOutput,to:node.key});save()}webPendingOutput='';renderWeb()});
    };
    makePort('in','Input for');makePort('out','Output from');
    group.addEventListener('click',()=>selectNode(node));group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectNode(node)}});
    let drag=null;
    group.addEventListener('pointerdown',event=>{if(event.target.closest('[data-port]'))return;drag={clientX:event.clientX,clientY:event.clientY,x:node.x,y:node.y};group.setPointerCapture(event.pointerId);group.style.cursor='grabbing';event.preventDefault()});
    group.addEventListener('pointermove',event=>{if(!drag)return;node.x=drag.x+(event.clientX-drag.clientX)/webViewport.scale;node.y=drag.y+(event.clientY-drag.clientY)/webViewport.scale;state.webPositions[node.key]={x:node.x,y:node.y};group.setAttribute('transform',`translate(${node.x} ${node.y})`);updateEdges()});
    const finishDrag=()=>{if(!drag)return;drag=null;group.style.cursor='grab';save()};group.addEventListener('pointerup',finishDrag);group.addEventListener('pointercancel',finishDrag);
    nodeLayer.appendChild(group);
  });
  svg.onpointerdown=event=>{if(event.target.closest('[data-node-key]'))return;svg.classList.add('is-panning');svg.setPointerCapture(event.pointerId);svg._panStart={x:event.clientX,y:event.clientY,panX:webViewport.x,panY:webViewport.y};event.preventDefault()};
  svg.onpointermove=event=>{if(!svg._panStart)return;webViewport.x=svg._panStart.panX+event.clientX-svg._panStart.x;webViewport.y=svg._panStart.panY+event.clientY-svg._panStart.y;updateTransform()};
  const endPan=()=>{svg._panStart=null;svg.classList.remove('is-panning')};svg.onpointerup=endPan;svg.onpointercancel=endPan;
  svg.onwheel=event=>{event.preventDefault();const rect=svg.getBoundingClientRect(),cursorX=event.clientX-rect.left,cursorY=event.clientY-rect.top,worldX=(cursorX-webViewport.x)/webViewport.scale,worldY=(cursorY-webViewport.y)/webViewport.scale;webViewport.scale=Math.max(.35,Math.min(1.8,webViewport.scale*Math.exp(-event.deltaY*.001)));webViewport.x=cursorX-worldX*webViewport.scale;webViewport.y=cursorY-worldY*webViewport.scale;updateTransform()};
  const zoomBy=factor=>{const centerX=width/2,centerY=height/2,worldX=(centerX-webViewport.x)/webViewport.scale,worldY=(centerY-webViewport.y)/webViewport.scale;webViewport.scale=Math.max(.35,Math.min(1.8,webViewport.scale*factor));webViewport.x=centerX-worldX*webViewport.scale;webViewport.y=centerY-worldY*webViewport.scale;updateTransform()};
  const fitMap=()=>{if(!visible.length||!mapVisible)return;const minX=Math.min(...visible.map(node=>node.x)),maxX=Math.max(...visible.map(node=>node.x+node.width)),minY=Math.min(...visible.map(node=>node.y)),maxY=Math.max(...visible.map(node=>node.y+node.height)),minScale=width<560&&visible.length<=4?.58:.35,scale=Math.max(minScale,Math.min(1.05,(width-48)/(maxX-minX+36),(height-60)/(maxY-minY+36)));webViewport.scale=scale;webViewport.x=(width-(minX+maxX)*scale)/2;webViewport.y=(height-(minY+maxY)*scale)/2;webViewport.initialized=true;updateTransform()};
  document.getElementById('web-zoom-out').onclick=()=>zoomBy(.85);document.getElementById('web-zoom-in').onclick=()=>zoomBy(1.18);document.getElementById('web-fit').onclick=fitMap;
  if(!webViewport.initialized&&mapVisible)fitMap();else updateTransform();
  document.getElementById('web-map-count').textContent=`${visible.length} nodes · ${uniqueLinks.length} links`;
  const addForm=document.getElementById('web-add-form');addForm.onsubmit=event=>{event.preventDefault();const input=document.getElementById('web-add-label'),label=input.value.trim();if(!label)return;const id=newProjectId(),custom={id,type:document.getElementById('web-add-type').value,label:label.slice(0,80)};state.webNodes.push(custom);state.webPositions[`custom:${id}`]={x:1010+Math.floor((state.webNodes.length-1)/9)*260,y:120+((state.webNodes.length-1)%9)*96};input.value='';webViewport.initialized=false;save();renderWeb()};
  document.getElementById('web-remove-node').onclick=()=>{const customId=webSelectedNode.startsWith('custom:')?webSelectedNode.slice(7):'';if(!customId)return;state.webNodes=state.webNodes.filter(node=>node.id!==customId);state.webLinks=state.webLinks.filter(link=>link.from!==webSelectedNode&&link.to!==webSelectedNode);delete state.webPositions[webSelectedNode];webSelectedNode='';save();renderWeb()};
  document.getElementById('web-category').onchange=()=>{webViewport.initialized=false;renderWeb()};document.getElementById('web-status').onchange=()=>{webViewport.initialized=false;renderWeb()};
  if(selection&&!webPendingOutput)selection.textContent='Select a node for details, drag it to arrange, or connect its ports.';
  document.getElementById('web-remove-node').disabled=!webSelectedNode.startsWith('custom:');
  document.getElementById('web-map-count').textContent=`${visible.length} nodes · ${uniqueLinks.length} links`;
  if(migratedLayout)save();
}
const FINALISE_ITEMS=[
  {id:'section-order',title:'Sections are titled and in the intended order.',hint:'Review your section list and confirm the sequence reads the way you want.'},
  {id:'character-pass',title:'Character names and appearances have had a continuity pass.',hint:'Use Characters and Story Web to catch details worth a second look.'},
  {id:'story-pass',title:'The story threads and ending have been reviewed.',hint:'Check that the ideas you set up have the landing you intended.'},
  {id:'proofread',title:'Spelling, punctuation, and dialogue have had a final read.',hint:'A slow read aloud can reveal small issues that a quick skim misses.'},
  {id:'backup',title:'I have saved a copy somewhere safe.',hint:'Export a plain-text or formatted copy below before you share or publish.'}
];
function renderFinalise(){
  const list=document.getElementById('finalise-checklist');list.innerHTML='';FINALISE_ITEMS.forEach(item=>{const label=document.createElement('label');label.className='check-item';const input=document.createElement('input');input.type='checkbox';input.checked=!!state.finaliseChecklist[item.id];input.setAttribute('aria-label',item.title);const copy=document.createElement('span');copy.className='check-copy';copy.innerHTML=`<strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.hint)}</small>`;input.addEventListener('change',()=>{state.finaliseChecklist[item.id]=input.checked;save();updateFinaliseProgress();renderHome()});label.append(input,copy);list.appendChild(label)});
  document.getElementById('final-word-count').textContent=totalWords().toLocaleString();document.getElementById('final-section-count').textContent=state.sections.length.toLocaleString();document.getElementById('final-character-count').textContent=totalCharacters().toLocaleString();updateFinaliseProgress();renderBookDesigner();
}
function updateFinaliseProgress(){const done=FINALISE_ITEMS.filter(x=>state.finaliseChecklist[x.id]).length,pct=Math.round(done/FINALISE_ITEMS.length*100);document.getElementById('finalise-count').textContent=`${done} of ${FINALISE_ITEMS.length} complete`;document.getElementById('finalise-progress').style.width=pct+'%'}
function validCoverArt(data){return typeof data==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data)?data:''}
async function encodeCoverArt(file){if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Choose a JPG, PNG, or WebP image.');if(file.size>20*1024*1024)throw new Error('Choose an image under 20 MB.');const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/bitmap.width,2200/bitmap.height,Math.sqrt(6000000/(bitmap.width*bitmap.height))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();const result=canvas.toDataURL('image/jpeg',.82);if(result.length>3*1024*1024)throw new Error('The compressed artwork is too large to store offline. Try a smaller image.');return result}
async function handleCoverArtUpload(file){if(!file)return;const note=document.getElementById('cover-art-note');note.textContent='Preparing cover art…';try{state.book.coverArt=await encodeCoverArt(file);state.book.coverArtName=file.name.slice(0,120);save();renderBookPreview();document.getElementById('remove-cover-art').disabled=false;note.textContent=`${file.name.slice(0,65)} · resized for offline storage`;toast('Cover art added to this project.')}catch(error){note.textContent=error.message||'Could not read that image.';toast(error.message||'Could not add cover art.')}finally{document.getElementById('cover-art-input').value=''}}
function removeCoverArt(){delete state.book.coverArt;delete state.book.coverArtName;save();renderBookDesigner();toast('Cover art removed.')}
function renderBookDesigner(){
  const book=state.book||(state.book={...DEFAULT_BOOK});
  document.getElementById('book-title').value=book.title||'';document.getElementById('book-subtitle').value=book.subtitle||'';document.getElementById('book-author').value=book.author||'';document.getElementById('book-cover-style').value=book.coverStyle||'botanical';document.getElementById('book-trim').value=book.trim||'trade';document.getElementById('book-font').value=book.font||'serif';document.getElementById('book-dedication').value=book.dedication||'';document.getElementById('book-include-toc').checked=book.includeToc!==false;document.getElementById('book-include-copyright').checked=book.includeCopyright!==false;document.getElementById('remove-cover-art').disabled=!validCoverArt(book.coverArt);document.getElementById('cover-art-note').textContent=book.coverArtName?`${book.coverArtName} · resized for offline storage`:'JPG, PNG, or WebP · resized and stored with this offline project.';renderBookPreview();
}
function updateBookSetting(key,value){state.book[key]=value;save();renderBookPreview()}
function renderBookPreview(){
  const target=document.getElementById('book-preview-pages');if(!target)return;const book=state.book||DEFAULT_BOOK,project=projects.find(p=>p.id===activeProjectId),title=book.title?.trim()||project?.name||'Untitled Book',author=book.author?.trim()||'Author name',subtitle=book.subtitle?.trim(),cover=['botanical','minimal','classic'].includes(book.coverStyle)?book.coverStyle:'botanical';
  const coverArt=validCoverArt(book.coverArt),pages=[`<article class="book-page book-cover-page cover-${cover}${coverArt?' has-cover-art':''}">${coverArt?`<img class="book-cover-art-preview" src="${coverArt}" alt="Uploaded cover artwork">`:''}<span class="book-page-label">${escapeHtml(cover==='botanical'?'A Loomwright edition':cover==='minimal'?'Title page':'Collected work')}</span><h3>${escapeHtml(title)}</h3>${subtitle?`<p class="book-cover-subtitle">${escapeHtml(subtitle)}</p>`:''}<span class="book-cover-author">${escapeHtml(author)}</span></article>`];
  if(book.includeCopyright!==false)pages.push(`<article class="book-page"><span class="book-page-label">Copyright</span><h3>${escapeHtml(title)}</h3><p>Copyright © ${new Date().getFullYear()} ${escapeHtml(author)}</p><p>All rights reserved.</p><p class="book-preview-note">Publication details can be added when the final edition is prepared.</p></article>`);
  if(book.dedication?.trim())pages.push(`<article class="book-page"><span class="book-page-label">Dedication</span><div style="min-height:190px;display:grid;place-items:center;text-align:center;font-style:italic">${escapeHtml(book.dedication).replace(/\n/g,'<br>')}</div></article>`);
  if(book.includeToc!==false)pages.push(`<article class="book-page book-toc-page ${book.trim==='trade'?'book-toc-clean':''}"><span class="book-page-label">Contents</span><h3>Contents</h3><div class="book-toc-list">${state.sections.map(s=>`<div class="book-toc-row"><span>${escapeHtml(s.title||'Untitled')}</span><span class="leader"></span></div>`).join('')}</div></article>`);
  const first=state.sections[0],excerpt=first?textOf(first.html||'').trim():'Your manuscript begins here.';const sample=excerpt.slice(0,380);
  pages.push(`<article class="book-page book-sample-page"><span class="book-page-label">Opening pages</span><h3>${escapeHtml(first?.title||'Your manuscript')}</h3>${sample?`<div class="sample-copy">${escapeHtml(sample).replace(/\n/g,'<br>')}${excerpt.length>380?'…':''}</div>`:'<p>Your opening chapter will appear here.</p>'}</article>`);
  target.innerHTML=pages.join('');target.dataset.trim=book.trim||'trade';target.dataset.font=book.font||'serif';
}
function bindBookDesigner(){
  [['book-title','title'],['book-subtitle','subtitle'],['book-author','author'],['book-dedication','dedication']].forEach(([id,key])=>document.getElementById(id).addEventListener('input',e=>updateBookSetting(key,e.target.value)));
  [['book-cover-style','coverStyle'],['book-trim','trim'],['book-font','font']].forEach(([id,key])=>document.getElementById(id).addEventListener('change',e=>updateBookSetting(key,e.target.value)));
  [['book-include-toc','includeToc'],['book-include-copyright','includeCopyright']].forEach(([id,key])=>document.getElementById(id).addEventListener('change',e=>updateBookSetting(key,e.target.checked)));
  document.getElementById('cover-art-input').addEventListener('change',e=>handleCoverArtUpload(e.target.files?.[0]));document.getElementById('remove-cover-art').addEventListener('click',removeCoverArt);
  document.getElementById('book-reset').addEventListener('click',()=>{state.book={...DEFAULT_BOOK};save();renderBookDesigner();toast('Book design reset.')});
}
const buildHtmlExportWithoutCoverArt=buildHtmlExport;
buildHtmlExport=function(){let doc=buildHtmlExportWithoutCoverArt();const book=state.book||DEFAULT_BOOK,subtitle=book.subtitle?.trim(),art=validCoverArt(book.coverArt);if(subtitle)doc=doc.replace(`<p>${subtitle}</p>`,`<p>${escapeHtml(subtitle)}</p>`);if(!art)return doc;return doc.replace('<style>','<style>.book-cover{position:relative;isolation:isolate;overflow:hidden}.book-cover-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}.book-cover.has-cover-art{background:transparent!important}.book-cover.has-cover-art:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#ffffff20 0%,#ffffffe0 48%,#fffffff2 100%);z-index:-1}\n').replace(/(<section class="book-cover [^"]+">)/,`$1<img class="book-cover-art" src="${art}" alt="Uploaded cover artwork">`)};
function downloadFile(filename,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function fileBase(){const project=projects.find(p=>p.id===activeProjectId);return (state.book?.title||project?.name||'loomwright-manuscript').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'loomwright-manuscript'}
function exportText(){const content=state.sections.map(s=>`${s.title||'Untitled'}\n${'='.repeat(Math.min(40,(s.title||'Untitled').length))}\n\n${textOf(s.html||'').trim()}`).join('\n\n\n');downloadFile(fileBase()+'.txt',content,'text/plain;charset=utf-8');toast('Plain-text copy downloaded.')}
function buildHtmlExport(){const book=state.book||DEFAULT_BOOK,project=projects.find(p=>p.id===activeProjectId),title=book.title?.trim()||project?.name||'Loomwright manuscript',author=book.author?.trim()||'',sections=state.sections.map((s,i)=>`<section class="chapter" id="section-${i+1}"><h1>${escapeHtml(s.title||'Untitled')}</h1>${sanitizeRichHtml(s.html||'<p></p>')}</section>`).join('\n'),copyright=book.includeCopyright!==false?`<section class="front-page copyright"><h1>${escapeHtml(title)}</h1><p>Copyright © ${new Date().getFullYear()} ${escapeHtml(author)}</p><p>All rights reserved.</p></section>`:'',dedication=book.dedication?.trim()?`<section class="front-page dedication"><p>${escapeHtml(book.dedication).replace(/\n/g,'<br>')}</p></section>`:'',toc=book.includeToc!==false?`<section class="front-page contents"><h1>Contents</h1><ol>${state.sections.map((s,i)=>`<li><a href="#section-${i+1}">${escapeHtml(s.title||'Untitled')}</a></li>`).join('')}</ol></section>`:'',font=book.font==='sans'?'Arial, sans-serif':book.font==='classic'?"'Palatino Linotype', Palatino, Georgia, serif":"Georgia, 'Iowan Old Style', serif",trim=book.trim==='a5'?'5.8in 8.3in':book.trim==='letter'?'8.5in 11in':'5in 8in',coverClass=['botanical','minimal','classic'].includes(book.coverStyle)?book.coverStyle:'botanical',cover=`<section class="book-cover ${coverClass}"><small>${coverClass==='classic'?'A collected work':'LOOMWRIGHT EDITION'}</small><h1>${escapeHtml(title)}</h1>${book.subtitle?`<p>${escapeHtml(book.subtitle)}</p>`:''}<footer>${escapeHtml(author)}</footer></section>`,doc=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>@page{size:${trim};margin:.75in}*{box-sizing:border-box}body{max-width:6in;margin:3rem auto;padding:0 1rem;font:18px/1.75 ${font};color:#26362d}.book-cover{min-height:85vh;display:flex;flex-direction:column;justify-content:center;text-align:center;page-break-after:always;padding:2rem;border:1px solid #91a997}.book-cover small,.book-cover footer{font: .8rem Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#596b5e}.book-cover h1{font:normal 2.3rem/1.2 ${font};margin:auto 0 1rem}.book-cover p{font:1rem/1.5 Arial,sans-serif;color:#64766a;margin:0 0 4rem}.book-cover footer{margin-top:auto}.book-cover.minimal{border-top:8px solid #91a997}.book-cover.classic{background:#f5f1e8;border:4px double #aeb8a9}.front-page{min-height:80vh;page-break-after:always;display:flex;flex-direction:column;justify-content:center}.copyright{font:14px/1.6 Arial,sans-serif;color:#596b5e}.dedication{text-align:center;font-style:italic}.contents h1,.chapter h1{font-size:1.5rem;font-weight:normal}.contents ol{padding-left:1.5rem}.contents li{margin:.5rem 0}.contents a{color:inherit;text-decoration:none}.chapter{page-break-before:always;margin:0 0 4rem}.chapter h1{margin:0 0 1.5rem}</style></head><body>${cover}${copyright}${dedication}${toc}${sections}</body></html>`;return doc}
function exportHtml(){downloadFile(fileBase()+'.html',buildHtmlExport(),'text/html;charset=utf-8');toast('Formatted book copy downloaded.')}
document.getElementById('export-txt').addEventListener('click',exportText);document.getElementById('export-html').addEventListener('click',exportHtml);

let confirmResolver=null,confirmPreviousFocus=null;
function showConfirmDialog(title,message,confirmLabel='Delete project'){
  const backdrop=document.getElementById('confirm-dialog'),titleEl=document.getElementById('confirm-dialog-title'),messageEl=document.getElementById('confirm-dialog-message'),confirmButton=document.getElementById('confirm-dialog-confirm');
  if(!backdrop||!titleEl||!messageEl||!confirmButton)return Promise.resolve(false);
  if(confirmResolver)confirmResolver(false);
  confirmPreviousFocus=document.activeElement;titleEl.textContent=title;messageEl.textContent=message;confirmButton.textContent=confirmLabel;backdrop.hidden=false;
  requestAnimationFrame(()=>document.getElementById('confirm-dialog-cancel')?.focus());
  return new Promise(resolve=>{confirmResolver=resolve});
}
function closeConfirmDialog(result){const backdrop=document.getElementById('confirm-dialog');if(!backdrop||backdrop.hidden)return;backdrop.hidden=true;const resolver=confirmResolver;confirmResolver=null;confirmPreviousFocus?.focus?.();confirmPreviousFocus=null;resolver?.(result)}
function setupConfirmDialog(){const backdrop=document.getElementById('confirm-dialog');document.getElementById('confirm-dialog-cancel')?.addEventListener('click',()=>closeConfirmDialog(false));document.getElementById('confirm-dialog-confirm')?.addEventListener('click',()=>closeConfirmDialog(true));backdrop?.addEventListener('click',event=>{if(event.target===backdrop)closeConfirmDialog(false)});document.addEventListener('keydown',event=>{if(!backdrop?.hidden&&event.key==='Escape'){event.preventDefault();closeConfirmDialog(false)}})}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2600)}
function revealApp(){clearTimeout(introTimer);const splash=document.getElementById('splash'),shell=document.getElementById('app-shell');splash.classList.add('leaving');shell.classList.add('is-ready');setTimeout(()=>{splash.hidden=true},360)}
function playIntro(){const splash=document.getElementById('splash'),shell=document.getElementById('app-shell');splash.hidden=false;splash.classList.remove('leaving');shell.classList.remove('is-ready');const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;introTimer=setTimeout(revealApp,reduced?220:1380)}
document.getElementById('skip-intro').addEventListener('click',revealApp);document.getElementById('replay-intro').addEventListener('click',()=>{switchView('home');playIntro()});
const settingsTabs=[...document.querySelectorAll('.settings-nav-btn[role="tab"]')];
function activateSettingsTab(tab,moveFocus=false){
  settingsTabs.forEach(item=>{const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;document.getElementById(item.dataset.settingsPanel).hidden=!selected});
  if(moveFocus)tab.focus();
}
settingsTabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>activateSettingsTab(tab));
  tab.addEventListener('keydown',event=>{
    const direction=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;
    if(event.key==='Home'){event.preventDefault();activateSettingsTab(settingsTabs[0],true);return}
    if(event.key==='End'){event.preventDefault();activateSettingsTab(settingsTabs[settingsTabs.length-1],true);return}
    if(direction){event.preventDefault();activateSettingsTab(settingsTabs[(index+direction+settingsTabs.length)%settingsTabs.length],true)}
  });
});
document.getElementById('palette-select').addEventListener('change',e=>updateAppSetting('palette',e.target.value));document.getElementById('theme-select').addEventListener('change',e=>updateAppSetting('theme',e.target.value));document.getElementById('bg-effect-select').addEventListener('change',e=>updateAppSetting('bgEffect',e.target.value));
const navToggle = document.getElementById('nav-position-toggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const nextPos = appSettings.navPosition === 'side' ? 'top' : 'side';
    updateAppSetting('navPosition', nextPos);
    applyTheme();
    toast(nextPos === 'side' ? 'Side-mounted navigation pill enabled.' : 'Top navigation enabled.');
  });
}
const navSegmented = document.getElementById('nav-position-segmented');
if (navSegmented) {
  navSegmented.querySelectorAll('.segmented-item').forEach(btn => {
    const handleSelect = () => {
      const pos = btn.dataset.navPos === 'side' ? 'side' : 'top';
      updateAppSetting('navPosition', pos);
      applyTheme();
      toast(pos === 'side' ? 'Side-mounted navigation pill enabled.' : 'Top navigation enabled.');
    };
    btn.addEventListener('click', handleSelect);
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleSelect();
      }
    });
  });
}
function setupWritingSettingsControls() {
  function bindSegmented(id, key) {
    const group = document.getElementById(id);
    if (!group) return;
    group.querySelectorAll('.segmented-item').forEach(btn => {
      btn.addEventListener('click', () => {
        updateWritingSetting(key, btn.dataset.value);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          updateWritingSetting(key, btn.dataset.value);
        }
      });
    });
  }

  function bindSwitch(id, key, getter, setter) {
    const btn = document.getElementById(id);
    if (!btn) return;
    function toggle() {
      const cur = getter ? getter() : Boolean(appSettings?.writing?.[key]);
      const next = !cur;
      if (setter) setter(next);
      else updateWritingSetting(key, next);
    }
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      }
    });
  }

  bindSegmented('writing-page-style', 'pageStyle');
  bindSegmented('writing-column-width', 'columnWidth');
  bindSegmented('writing-toolbar-mode', 'toolbarMode');
  bindSegmented('writing-recogniser-sensitivity', 'recogniserSensitivity');

  bindSwitch('writing-first-line-indent', 'firstLineIndent');
  bindSwitch('writing-spellcheck', 'spellcheck');
  bindSwitch('writing-smart-quotes', 'smartQuotes');
  bindSwitch('writing-typewriter-scroll', 'typewriterScroll');

  bindSwitch('writing-focus-hide-nav', null, () => appSettings?.writing?.focusHides?.nav, v => {
    updateWritingSetting('focusHides', { ...(appSettings?.writing?.focusHides || {}), nav: v });
  });
  bindSwitch('writing-focus-hide-toolbar', null, () => appSettings?.writing?.focusHides?.toolbar, v => {
    updateWritingSetting('focusHides', { ...(appSettings?.writing?.focusHides || {}), toolbar: v });
  });
  bindSwitch('writing-focus-hide-footer', null, () => appSettings?.writing?.focusHides?.footer, v => {
    updateWritingSetting('focusHides', { ...(appSettings?.writing?.focusHides || {}), footer: v });
  });

  bindSwitch('writing-autosave', 'autosave');
  bindSwitch('writing-dash-separates', 'dashSeparatesWords');

  document.getElementById('writing-font-family')?.addEventListener('change', e => {
    updateWritingSetting('fontFamily', e.target.value);
  });
  document.getElementById('writing-font-size')?.addEventListener('input', e => {
    updateWritingSetting('fontSize', Number(e.target.value));
  });
  document.getElementById('writing-line-height')?.addEventListener('input', e => {
    updateWritingSetting('lineHeight', Number(e.target.value));
  });
  document.getElementById('writing-autosave-delay')?.addEventListener('input', e => {
    updateWritingSetting('autosaveDelayMs', Number(e.target.value));
  });
  document.getElementById('writing-daily-goal')?.addEventListener('input', e => {
    updateWritingSetting('dailyGoal', Number(e.target.value));
  });

  document.getElementById('writing-restore-chars')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Restore hidden character suggestions?',
      'This will bring back all character suggestions previously dismissed from your manuscript roster.',
      'Restore characters'
    );
    if (confirmed) {
      restoreIgnoredCharacters();
      toast('Hidden character suggestions restored.');
    }
  });
  document.getElementById('btn-scan-characters')?.addEventListener('click', scanCharacters);
  ['character-search','character-sort','character-layout'].forEach(id=>document.getElementById(id)?.addEventListener(id==='character-search'?'input':'change',()=>renderCharacters()));
  document.getElementById('character-sheet-save')?.addEventListener('click',saveCharacterSheet);document.getElementById('char-sheet-merge-button')?.addEventListener('click',()=>{const modal=document.getElementById('character-sheet'),target=modal?.querySelector('#char-sheet-merge')?.value;if(target){mergeCharacter(modal.dataset.character,target);closeCharacterSheet()}});document.getElementById('character-sheet-close')?.addEventListener('click',closeCharacterSheet);document.getElementById('character-sheet-cancel')?.addEventListener('click',closeCharacterSheet);document.getElementById('character-sheet')?.addEventListener('click',event=>{if(event.target.id==='character-sheet')closeCharacterSheet()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.getElementById('character-sheet')?.hidden)closeCharacterSheet()});

  document.getElementById('writing-reset-settings')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Reset writing settings?',
      'All typography, spacing, page style, and editor settings will be restored to their factory defaults.',
      'Reset writing settings'
    );
    if (confirmed) {
      appSettings.writing = { ...WRITING_DEFAULTS, focusHides: { ...WRITING_DEFAULTS.focusHides } };
      appSettingsTouched = true;
      persistAppSettings();
      persistProjectStore();
      applyWritingSettingsLive();
      renderWritingSettingsUI();
      recountAllSections();
      toast('Writing settings reset.');
    }
  });
}
setupWritingSettingsControls();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(appSettings.theme==='auto')applyTheme()});
document.getElementById('project-create-form').addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('new-project-name');createProject(input.value);input.value=''});
function setupWriteDragDrop(){
  const writeView = document.getElementById('view-write');
  if(!writeView) return;
  ['dragenter','dragover'].forEach(name=>{
    writeView.addEventListener(name, e=>{
      if(e.dataTransfer?.types?.includes('Files')){
        e.preventDefault();
        writeView.classList.add('write-drag-over');
      }
    });
  });
  ['dragleave','dragend'].forEach(name=>{
    writeView.addEventListener(name, e=>{
      if(!writeView.contains(e.relatedTarget)){
        writeView.classList.remove('write-drag-over');
      }
    });
  });
  writeView.addEventListener('drop', async e=>{
    if(e.dataTransfer?.files?.length){
      e.preventDefault();
      writeView.classList.remove('write-drag-over');
      await importChapterFiles(e.dataTransfer.files);
    }
  });
}

/* Multi-Dragon Atmospheric Flight Engine (Dynamic Omni-directional Kinematics, Watermark-Free) */
function initDragonFlight() {
  const canvas = document.getElementById('dragon-flight-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0, height = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Helper to spawn a fresh flight path entering from any screen perimeter
  function spawnDragon(scale, speed, delayTicks = 0) {
    const margin = 260;
    // Pick an entry side: 0=Left, 1=Right, 2=Top, 3=Bottom
    const entrySide = Math.floor(Math.random() * 4);
    let x, y, angle;

    if (entrySide === 0) { // Left
      x = -margin;
      y = Math.random() * height;
      angle = (Math.random() - 0.5) * 0.9; // heading mostly rightwards
    } else if (entrySide === 1) { // Right
      x = width + margin;
      y = Math.random() * height;
      angle = Math.PI + (Math.random() - 0.5) * 0.9; // heading mostly leftwards
    } else if (entrySide === 2) { // Top
      x = Math.random() * width;
      y = -margin;
      angle = Math.PI * 0.5 + (Math.random() - 0.5) * 1.1; // heading downwards
    } else { // Bottom
      x = Math.random() * width;
      y = height + margin;
      angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.1; // heading upwards
    }

    // Number of segments for the sinuous spine
    const numPoints = 36;
    const segDist = 14 * scale;
    const history = [];
    for (let i = 0; i < numPoints * 4; i++) {
      history.push({
        x: x - Math.cos(angle) * (i * segDist * 0.25),
        y: y - Math.sin(angle) * (i * segDist * 0.25),
        angle: angle
      });
    }

    return {
      x,
      y,
      angle,
      targetAngle: angle,
      turnTimer: 0,
      scale,
      speed,
      bodyWaveSpeed: 4.8 + Math.random() * 0.8,
      numPoints,
      segDist,
      history,
      active: delayTicks <= 0,
      delayTicks
    };
  }

  // 3 dragons with increased scale (~0.58 to 0.72) and staggered launches
  const dragons = [
    spawnDragon(0.68, 1.95, 0),    // Main majesty dragon
    spawnDragon(0.52, 1.55, 120),  // Mid-scale companion
    spawnDragon(0.60, 1.75, 260)   // Second swooping dragon
  ];

  let tick = 0;
  let rafId = null;

  function renderDragon(d, time) {
    ctx.save();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const computed = getComputedStyle(document.documentElement);
    const bodyColor = computed.getPropertyValue('--dragon-body').trim() || (isDark ? '#8eaa94' : '#26362d');
    const goldColor = computed.getPropertyValue('--dragon-gold').trim() || (isDark ? '#e4bf68' : '#c89b3c');
    const highlightColor = computed.getPropertyValue('--dragon-highlight').trim() || (isDark ? '#ffffff' : '#1e3527');

    const pts = [];
    const step = 4;
    for (let i = 0; i < d.numPoints; i++) {
      const hIdx = Math.min(i * step, d.history.length - 1);
      const h = d.history[hIdx] || { x: d.x, y: d.y, angle: d.angle };
      const segT = i / (d.numPoints - 1);

      // Sinuous swimming wave perpendicular to local heading
      const perpAngle = h.angle + Math.PI * 0.5;
      const wave = Math.sin(time * d.bodyWaveSpeed - (i * 0.44)) * (20 * d.scale * (1 - segT * 0.3));
      const px = h.x + Math.cos(perpAngle) * wave;
      const py = h.y + Math.sin(perpAngle) * wave;
      pts.push({ x: px, y: py, angle: h.angle });
    }

    if (pts.length < 2) {
      ctx.restore();
      return;
    }

    const bodyWidth = 18 * d.scale;

    // Draw Dorsal Fin Ridge along undulating spine
    ctx.strokeStyle = goldColor;
    ctx.lineWidth = 2.4 * d.scale;
    ctx.beginPath();
    for (let i = 2; i < pts.length - 2; i += 2) {
      const p = pts[i];
      const prev = pts[i - 1];
      const dx = p.x - prev.x, dy = p.y - prev.y;
      const nx = -dy, ny = dx;
      const len = Math.hypot(nx, ny) || 1;
      const finH = 17 * d.scale * (1 - (i / pts.length) * 0.4);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (nx / len) * finH, p.y + (ny / len) * finH);
    }
    ctx.stroke();

    // Draw Sinuous Body (Thick brush with belly tone)
    for (let i = pts.length - 1; i > 0; i--) {
      const p1 = pts[i];
      const p0 = pts[i - 1];
      const t = i / pts.length;
      const w = bodyWidth * (1 - t * 0.65);

      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = Math.max(w, 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      // Belly under-tone line
      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = Math.max(w * 0.35, 1);
      const perp = p1.angle + Math.PI * 0.5;
      const ox = Math.cos(perp) * (w * 0.25);
      const oy = Math.sin(perp) * (w * 0.25);
      ctx.beginPath();
      ctx.moveTo(p0.x + ox, p0.y + oy);
      ctx.lineTo(p1.x + ox, p1.y + oy);
      ctx.stroke();
    }

    // Four Claws (Active step cycles along body orientation)
    const legIndices = [8, 13, 20, 26];
    legIndices.forEach((idx, lIdx) => {
      if (pts[idx]) {
        const lp = pts[idx];
        const sideSign = (lIdx % 2 === 0 ? 1 : -1);
        const legPerp = lp.angle + (Math.PI * 0.5 * sideSign);
        const legReach = Math.sin(time * 3.5 + lIdx) * (6 * d.scale);

        const kneeX = lp.x + Math.cos(legPerp) * (18 * d.scale) + Math.cos(lp.angle) * (4 * d.scale);
        const kneeY = lp.y + Math.sin(legPerp) * (18 * d.scale) + Math.sin(lp.angle) * (4 * d.scale);
        const footX = kneeX + Math.cos(legPerp) * (10 * d.scale) + Math.cos(lp.angle) * (12 * d.scale + legReach);
        const footY = kneeY + Math.sin(legPerp) * (10 * d.scale) + Math.sin(lp.angle) * (12 * d.scale + legReach);

        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 2.6 * d.scale;
        ctx.beginPath();
        ctx.moveTo(lp.x, lp.y);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);

        // 3 Sharp Talons
        const talonLen = 6 * d.scale;
        const clawAngle = lp.angle + (0.2 * sideSign);
        ctx.lineTo(footX + Math.cos(clawAngle + 0.3) * talonLen, footY + Math.sin(clawAngle + 0.3) * talonLen);
        ctx.moveTo(footX, footY);
        ctx.lineTo(footX + Math.cos(clawAngle) * (talonLen * 1.2), footY + Math.sin(clawAngle) * (talonLen * 1.2));
        ctx.moveTo(footX, footY);
        ctx.lineTo(footX + Math.cos(clawAngle - 0.3) * talonLen, footY + Math.sin(clawAngle - 0.3) * talonLen);
        ctx.stroke();
      }
    });

    // Flowing Tail Fan (Tuft)
    const tailTip = pts[pts.length - 1];
    const tailPre = pts[pts.length - 2];
    if (tailTip && tailPre) {
      const tAngle = Math.atan2(tailTip.y - tailPre.y, tailTip.x - tailPre.x);
      ctx.save();
      ctx.translate(tailTip.x, tailTip.y);
      ctx.rotate(tAngle);
      ctx.fillStyle = goldColor;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(12 * d.scale, -18 * d.scale, 30 * d.scale, -12 * d.scale, 38 * d.scale, 0);
      ctx.bezierCurveTo(30 * d.scale, 12 * d.scale, 12 * d.scale, 18 * d.scale, 0, 0);
      ctx.fill();
      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // Majestic Dragon Head, Antlers, Mane & Whiskers
    const pHead = pts[0];
    const pNeck = pts[1];
    if (pHead && pNeck) {
      const hAngle = Math.atan2(pHead.y - pNeck.y, pHead.x - pNeck.x);
      ctx.save();
      ctx.translate(pHead.x, pHead.y);
      ctx.rotate(hAngle);

      // Skull & Snout
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(6 * d.scale, 0, 18 * d.scale, 10 * d.scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Lower Jaw
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 2.4 * d.scale;
      ctx.beginPath();
      ctx.moveTo(8 * d.scale, 3 * d.scale);
      ctx.lineTo(19 * d.scale, 6 * d.scale);
      ctx.stroke();

      // Stag Antlers
      ctx.strokeStyle = goldColor;
      ctx.lineWidth = 2.8 * d.scale;
      ctx.beginPath();
      ctx.moveTo(-3 * d.scale, -7 * d.scale);
      ctx.lineTo(-16 * d.scale, -26 * d.scale);
      ctx.lineTo(-10 * d.scale, -34 * d.scale);
      ctx.moveTo(-10 * d.scale, -18 * d.scale);
      ctx.lineTo(-2 * d.scale, -23 * d.scale);
      ctx.stroke();

      // Flowing Mane
      ctx.strokeStyle = goldColor;
      ctx.lineWidth = 2.2 * d.scale;
      ctx.beginPath();
      ctx.moveTo(-8 * d.scale, -4 * d.scale);
      ctx.quadraticCurveTo(-24 * d.scale, -14 * d.scale, -36 * d.scale, -6 * d.scale);
      ctx.moveTo(-5 * d.scale, 4 * d.scale);
      ctx.quadraticCurveTo(-22 * d.scale, 9 * d.scale, -34 * d.scale, 16 * d.scale);
      ctx.stroke();

      // Expressive Eye
      ctx.fillStyle = goldColor;
      ctx.beginPath();
      ctx.arc(5 * d.scale, -4 * d.scale, 3.2 * d.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isDark ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(5.5 * d.scale, -4 * d.scale, 1.5 * d.scale, 0, Math.PI * 2);
      ctx.fill();

      // Flowing Long Barbels / Whiskers
      const wWave = Math.sin(time * 4) * 6 * d.scale;
      ctx.strokeStyle = goldColor;
      ctx.lineWidth = 1.8 * d.scale;
      ctx.beginPath();
      ctx.moveTo(16 * d.scale, -3 * d.scale);
      ctx.bezierCurveTo(32 * d.scale, -10 * d.scale + wWave, 46 * d.scale, 8 * d.scale - wWave, 62 * d.scale, 6 * d.scale);
      ctx.moveTo(14 * d.scale, 3 * d.scale);
      ctx.bezierCurveTo(28 * d.scale, 8 * d.scale - wWave, 38 * d.scale, 18 * d.scale + wWave, 52 * d.scale, 20 * d.scale);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  function loop() {
    const isEffectActive = document.documentElement.getAttribute('data-bg-effect') === 'dragon';
    if (!isEffectActive) {
      ctx.clearRect(0, 0, width, height);
      rafId = requestAnimationFrame(loop);
      return;
    }

    ctx.clearRect(0, 0, width, height);
    tick += 0.016;

    dragons.forEach((d, idx) => {
      if (!d.active) {
        d.delayTicks--;
        if (d.delayTicks <= 0) d.active = true;
        return;
      }

      // Smooth steering toward targetAngle for curving, diagonal, and vertical flight paths
      d.turnTimer--;
      if (d.turnTimer <= 0) {
        // Change heading naturally every few seconds
        d.targetAngle += (Math.random() - 0.5) * 1.5;
        d.turnTimer = 80 + Math.floor(Math.random() * 120);

        // If wandering too close to edges while in the middle of screen, guide back towards interior
        if (d.x > 150 && d.x < width - 150 && d.y > 150 && d.y < height - 150) {
          const centerAngle = Math.atan2(height * 0.5 - d.y, width * 0.5 - d.x);
          d.targetAngle = d.targetAngle * 0.7 + centerAngle * 0.3;
        }
      }

      // Smooth angle interpolation
      let diff = d.targetAngle - d.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      d.angle += diff * 0.035;

      // Advance head in 2D space
      d.x += Math.cos(d.angle) * d.speed;
      d.y += Math.sin(d.angle) * d.speed;

      // Prepend to history for vertebrae tracking
      d.history.unshift({ x: d.x, y: d.y, angle: d.angle });
      if (d.history.length > d.numPoints * 5) {
        d.history.pop();
      }

      // Screen exit check: when dragon flies completely off-screen, respawn on a new perimeter side
      const margin = 320;
      const isOffscreen = (
        d.x < -margin ||
        d.x > width + margin ||
        d.y < -margin ||
        d.y > height + margin
      );

      // Only respawn if it had already entered the screen
      if (isOffscreen && d.history.length >= d.numPoints * 4) {
        const nextScale = 0.50 + Math.random() * 0.22;
        const nextSpeed = 1.5 + Math.random() * 0.6;
        const fresh = spawnDragon(nextScale, nextSpeed, Math.floor(Math.random() * 100));
        Object.assign(d, fresh);
      }

      renderDragon(d, tick);
    });

    rafId = requestAnimationFrame(loop);
  }

  loop();
}

bindBookDesigner();
setupConfirmDialog();
renderAppVersion();
setupZenMode();
setupGitSync();
setupWriteDragDrop();
initDragonFlight();
window.addEventListener('beforeunload', () => { flushWriterSave(); });
setupOfflineApp();initializeOfflineStorage().then(startSharedSync).finally(playIntro);
