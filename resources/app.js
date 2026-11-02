'use strict';
// Protocol v6: ephemeral ECDH + mandatory out-of-band SAS verification.
// The room code identifies a room; it is never used as an encryption key.
(() => {
  const $ = id => document.getElementById(id);
  // Only a visual preference is stored; no transfer data or keys persist.
  const colorPreference=window.matchMedia('(prefers-color-scheme: dark)');
  let themePreference=null;
  try { const saved=localStorage.getItem('vanillawarp-theme');if(saved==='light'||saved==='dark')themePreference=saved; } catch(_){}
  function applyTheme(theme) {
    const dark=theme==='dark';document.documentElement.dataset.theme=dark?'dark':'light';
    const button=$('themeToggle');if(button)button.setAttribute('aria-pressed',String(dark));
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#10211c':'#f6f7f3';
  }
  applyTheme(themePreference || (colorPreference.matches?'dark':'light'));
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('show-splash');
    // Never leave the decorative splash in the way if initialization fails.
    setTimeout(()=>document.documentElement.classList.remove('show-splash'),2500);
  }
  function initAppearance() {
    applyTheme(themePreference || (colorPreference.matches?'dark':'light'));
    $('themeToggle').addEventListener('click',()=>{
      themePreference=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(themePreference);
      try { localStorage.setItem('vanillawarp-theme',themePreference); } catch(_){}
    });
    const followSystem=()=>{if(!themePreference)applyTheme(colorPreference.matches?'dark':'light');};
    if(colorPreference.addEventListener)colorPreference.addEventListener('change',followSystem);else if(colorPreference.addListener)colorPreference.addListener(followSystem);
    window.addEventListener('storage',e=>{if(e.key==='vanillawarp-theme'){themePreference=e.newValue==='dark'||e.newValue==='light'?e.newValue:null;followSystem();if(themePreference)applyTheme(themePreference);}});
    if(document.documentElement.classList.contains('show-splash'))setTimeout(()=>{
      $('splash').classList.add('splash-leaving');setTimeout(()=>document.documentElement.classList.remove('show-splash'),300);
    },500);
  }
  let currentStage='connect';
  function setStage(stage,stopped=false) {
    if(stage)currentStage=stage;
    const stages=['connect','verify','transfer','complete'],active=stages.indexOf(currentStage);
    document.querySelectorAll('#transferSteps li').forEach((item,i)=>{
      const labels=['Connect','Verify','Transfer','Complete'];
      item.classList.toggle('is-done',i<active);item.classList.toggle('is-current',i===active);item.classList.toggle('is-stopped',stopped&&i===active);
      if(i===active)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
      item.setAttribute('aria-label',`${labels[i]}, ${i<active?'completed':i===active?(stopped?'stopped':'current'):'upcoming'}`);
    });
  }
  const WORDS = ['amber','apple','atlas','bamboo','beacon','birch','blue','bravo','cedar','cloud','coral','dawn','delta','dune','echo','fern','flame','forest','globe','gold','harbor','hazel','jade','lemon','lunar','maple','mint','ocean','olive','pearl','river','willow'];
  const STUN = [{urls:'stun:stun.cloudflare.com:3478'}];
  const MAX_FALLBACK = 128 * 1024 * 1024;
  const PREFETCH_CHUNKS = 4;
  const MAX_QUEUE_BYTES = 24 * 1024 * 1024, MAX_QUEUE_MESSAGES = 512, MAX_FRAME_BYTES = 1024 * 1024;
  let backend = null, online = false, selection = null, session = null, wakeLock = null, selectionVersion = 0, recoveryRole = null;
  const enc = new TextEncoder();
  const show = (id, yes = true) => { $(id).hidden = !yes; };
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Transfer cancelled'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new Error('Transfer cancelled')); };
    signal.addEventListener('abort', stop, {once:true});
  });
  function notice(message, error = false) { $('noticeText').textContent = message; $('notice').classList.toggle('error', error); show('notice'); }
  function view(name) {
    for (const id of ['homeView','sendView','receiveView','sessionView']) show(id, id === name);
    window.scrollTo({top:0, behavior:'auto'});
    if(name!=='sessionView')requestAnimationFrame(()=>{const heading=$(name).querySelector('h1');if(heading && !$(name).hidden)heading.focus({preventScroll:true});});
  }
  function panel(name) {
    for (const id of ['loadingPanel','codePanel','destinationPanel','pairingPanel','progressPanel','donePanel','errorPanel']) show(id, id === name);
    const stages={loadingPanel:'connect',codePanel:'connect',destinationPanel:'connect',pairingPanel:'verify',progressPanel:'transfer',donePanel:'complete'};setStage(stages[name]||null,name==='errorPanel');
    requestAnimationFrame(()=>{const target=$(name).querySelector('h2, #roomCode');if(target && !$(name).hidden && !$('sessionView').hidden){target.tabIndex=-1;target.focus({preventScroll:true});}});
  }
  function phase(text) { $('sessionSubtitle').textContent=text; }
  function conflictDescription() {
    const messages={ask:'Each existing file needs your approval before replacement. Cancel skips it.',skip:'Existing files will be skipped without checking whether they match.',replace:'Existing files with the same name will be replaced without further prompts. Other files are not deleted.',verify:'Recovery rereads both copies. Matching files are reused; differences require your approval to replace. Partial files restart.'};
    $('conflictDescription').textContent=$('conflictPolicy').disabled?'Your browser manages download conflicts; in-app conflict rules do not apply.':messages[$('conflictPolicy').value];
  }
  function status(ok, label) { online = ok; $('connectionStatus').classList.toggle('online', ok); $('connectionStatus').classList.toggle('offline', !ok); $('connectionLabel').textContent = label; }
  function secureContext() {
    if (window.isSecureContext === false || typeof crypto === 'undefined' || !crypto.subtle) { notice('Use HTTPS or localhost for secure transfers.', true); return false; }
    return true;
  }
  async function connectServer() {
    status(false, 'Checking server');
    try {
      if (location.hostname.toLowerCase().endsWith('.github.io')) {
        const configUrl = new URL('server-config.json', location.href); configUrl.searchParams.set('t', Date.now());
        const r = await fetch(configUrl, {cache:'no-store'});
        if (!r.ok) throw new Error('The server address has not been published yet.');
        const config = await r.json();
        const u = new URL(config.serverUrl);
        if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || !/\.(lhr\.life|localhost\.run)$/i.test(u.hostname) || (u.pathname !== '/' && u.pathname !== '')) throw new Error('Invalid published server address.');
        backend = u.origin;
      } else backend = location.origin;
      const response = await fetch(backend + '/api/status', {cache:'no-store', signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('Server unavailable');
      const info = await response.json();
      status(true, info.relayConfigured ? 'Server online · relay configured' : 'Server online · direct first');
      return true;
    } catch (e) {
      backend = null; status(false, 'Server offline');
      return false;
    }
  }
  async function ensureServer() {
    if (!secureContext()) return false;
    if (!online && !await connectServer()) { notice('Server is offline. Ask the host to start VanillaWarp and wait for publishing.', true); return false; }
    return true;
  }
  async function request(path, options = {}) {
    if (!backend) throw new Error('Server is offline.');
    const response = await fetch(backend + path, {...options, cache:'no-store'});
    if (!response.ok) {
      let info; try { info = await response.json(); } catch (_) {}
      const message = info && info.error ? info.error : `Server request failed (${response.status})`;
      const error = new Error(message); error.status = response.status; throw error;
    }
    return response.json();
  }
  function codeQuery(code) { return '?code=' + encodeURIComponent(code); }
  const formatCode = code => code.slice(0,4) + '-' + code.slice(4);
  function humanBytes(bytes) {
    if (!bytes) return '0 B'; const units=['B','KB','MB','GB','TB']; const n=Math.min(units.length-1, Math.floor(Math.log(bytes)/Math.log(1024)));
    return (bytes / Math.pow(1024,n)).toFixed(n ? 1 : 0) + ' ' + units[n];
  }
  function renderSelection() {
    if (!selection) { show('selection',false); show('selectionDetails',false); $('startSend').disabled = true; return; }
    const total = selection.files.reduce((n,f) => n+f.size, 0);
    $('selectionName').textContent = selection.folder ? selection.folder.name : selection.files.length === 1 ? selection.files[0].name : `${selection.files.length} files`;
    $('selectionDetail').textContent = `${selection.files.length} ${selection.files.length === 1 ? 'file' : 'files'} · ${humanBytes(total)}${selection.folder ? ' · folder' : ''}`;
    const paths = selection.folder ? selection.folder.directories.map(p => p.join('/')+'/').concat(selection.folder.entries.map(x => x.path.join('/'))) : selection.files.map(f => f.name);
    $('selectionPreview').textContent = paths.slice(0,100).join('\n') + (paths.length>100 ? `\n…and ${paths.length-100} more` : '');
    show('selection'); show('selectionDetails'); $('startSend').disabled = false;
  }
  function stageFiles(list) {
    if (session || !list || !list.length) return;
    selectionVersion++; show('notice',false); selection = {files:Array.from(list), folder:null}; renderSelection();
  }
  async function chooseFolder() {
    if (session) return;
    if (!window.showDirectoryPicker) { notice('Drop a folder onto this page to include empty folders. Folder receiving requires a browser with destination-folder access.', true); return; }
    const version=++selectionVersion; show('notice',false);
    try {
      const root = await window.showDirectoryPicker({mode:'read'}), entries=[], directories=[];
      validPath([root.name]);
      async function walk(dir, path) {
        directories.push(path);
        for await (const entry of dir.values()) {
          const next=path.concat(entry.name);validPath(next);
          if (entry.kind==='directory') await walk(entry,next);
          else if (entry.kind==='file') entries.push({file:await entry.getFile(),path:next});
          else throw new Error('Unsupported folder entry; cannot preserve the complete folder.');
        }
      }
      await walk(root,[root.name]);
      if(version !== selectionVersion || session)return;
      selection = {files:entries.map(x=>x.file), folder:{name:root.name,entries,directories}}; renderSelection();
    } catch(e) { if (e.name!=='AbortError' && version===selectionVersion && !session) { selection=null;renderSelection();notice(`Could not read folder: ${e.message}`,true); } }
  }
  // Directory entries from a drop enumerate empty directories; a webkitdirectory
  // file input does not, so it must never be used as a silent fallback.
  async function stageDroppedFolder(root, version) {
    const entries=[], directories=[];
    async function walk(entry, path) {
      validPath(path);
      if (entry.isDirectory) {
        directories.push(path);
        const reader=entry.createReader();
        while (true) {
          const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
          if (!batch.length) break;
          for (const child of batch) await walk(child,path.concat(child.name));
        }
      } else if (entry.isFile) {
        const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
        entries.push({file,path});
      } else throw new Error('Unsupported folder entry; cannot preserve the complete folder.');
    }
    await walk(root,[root.name]);
    if(session || version !== selectionVersion)return;
    show('notice',false);
    selection={files:entries.map(x=>x.file),folder:{name:root.name,entries,directories}};
    renderSelection();
  }
  function validPath(path) {
    if (!Array.isArray(path) || !path.length || path.length>256 || path.some(p => typeof p !== 'string' || !p || p.length>1024 || p==='.' || p==='..' || /[/\\\x00-\x1f]/.test(p)) || path.reduce((n,p)=>n+p.length,0)>65536) throw new Error('Invalid path received.');
    return path;
  }
  async function directory(root,path,create) { let dir=root; for (const part of validPath(path)) dir=await dir.getDirectoryHandle(part,{create}); return dir; }
  function base64(bytes) { let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function unbase64(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(text)) throw new Error('Invalid pairing key.');
    const str=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='); return Uint8Array.from(str,c=>c.charCodeAt(0));
  }
  function setUint64(view, offset, value) {
    if(!Number.isSafeInteger(value) || value<0)throw new Error('Transfer counter exhausted.');
    view.setUint32(offset,Math.floor(value/0x100000000)); view.setUint32(offset+4,value>>>0);
  }
  async function fileContext(index,path,size) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify([6,index,path,size]))));
  }
  function chunkContext(context,offset) {
    const aad=new Uint8Array(40);aad.set(context);setUint64(new DataView(aad.buffer),32,offset);return aad;
  }
  async function makePair() {
    const keys=await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
    return {privateKey:keys.privateKey, publicKey:base64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))};
  }
  async function pairingKeys(privateKey, offer, answer, code, role) {
    if (offer.version!==6 || answer.version!==6 || typeof offer.folder!=='boolean' || !offer.sdp || offer.sdp.type!=='offer' || typeof offer.sdp.sdp!=='string' || !answer.sdp || answer.sdp.type!=='answer' || typeof answer.sdp.sdp!=='string') throw new Error('Invalid pairing details.');
    const peerPublic=await crypto.subtle.importKey('raw',unbase64(role==='sender' ? answer.pub : offer.pub),{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peerPublic},privateKey,256);
    // The transcript binds both ephemeral keys, both SDP fingerprints and the room.
    const transcript=enc.encode(JSON.stringify([6,code,offer.folder,offer.pub,answer.pub,offer.sdp.sdp,answer.sdp.sdp]));
    const salt=await crypto.subtle.digest('SHA-256',transcript);
    const root=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
    const params=info=>({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(info)});
    const encryption=await crypto.subtle.deriveKey(params('VanillaWarp v6 encryption'),root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const sasKey=await crypto.subtle.deriveKey(params('VanillaWarp v6 verification'),root,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sas=new Uint8Array(await crypto.subtle.sign('HMAC',sasKey,enc.encode('Compare these words on a trusted channel')));
    const words=[];
    for(let i=0;i<8;i++) { let value=0;for(let j=0;j<5;j++){const bit=i*5+j;value=(value<<1)|((sas[bit>>3]>>(7-(bit&7)))&1);}words.push(WORDS[value]); }
    return {encryption, phrase:words.join(' · ')};
  }
  function begin(role) {
    if (session) throw new Error('A transfer is already active.');
    const s={role,abort:new AbortController(),done:false,pc:null,dc:null,ownerToken:null,joinToken:null,code:null,confirmed:false,abortWriter:null,rejectPicker:null,rejectReplies:null,remoteReady:null,localPaused:false,remotePaused:false,speedSamples:[],lastProgressPaint:0,statsTimer:null,verifySaved:false,summary:{completed:0,skipped:0,recovered:0,checked:0},transferStarted:null};
    session=s; show('cancelTop'); view('sessionView'); panel('loadingPanel');
    $('sessionEyebrow').textContent=role==='sender'?'SEND / 02':'RECEIVE / 02';
    $('sessionTitle').innerHTML='Almost there<span>.</span>'; phase('Preparing the connection. Keep this page open.');
    $('loadingTitle').textContent='Getting things ready.'; $('loadingText').textContent='Connecting to the server…';
    $('pauseButton').textContent='Pause transfer'; $('pauseStatus').textContent=''; $('progressRoute').textContent='Connection: checking…'; $('progressEta').textContent='ETA: —'; $('progressDetails').open=false; show('hashHint',false); progress(0,1,0,'');
    return s;
  }
  function check(s) { if (s.done || s.abort.signal.aborted) throw new Error('Transfer cancelled.'); }
  function closeSession(s, message, good=false, delayClose=false) {
    if (!s || s.done) return;
    s.done=true;
    if (s.statsTimer) clearInterval(s.statsTimer);
    if (s.rejectPicker) { s.rejectPicker(new Error(message)); s.rejectPicker=null; }
    if (s.rejectReplies) s.rejectReplies(new Error(message));
    if (!good && s.abortWriter) Promise.resolve(s.abortWriter()).catch(()=>{});
    s.abort.abort();
    if (s.code && backend && (s.ownerToken || s.joinToken)) {
      const headers=s.ownerToken?{'X-Owner-Token':s.ownerToken}:{'X-Join-Token':s.joinToken};
      fetch(backend+'/api/room/cancel'+codeQuery(s.code),{method:'POST',headers,keepalive:true}).catch(()=>{});
    }
    const close=()=>{ try { if(s.dc)s.dc.close(); if(s.pc)s.pc.close(); } catch(_){} };
    if(delayClose) setTimeout(close,1000); else close();
    if (wakeLock) { wakeLock.release().catch(()=>{}); wakeLock=null; }
    if(session===s)session=null;
    show('cancelTop',false);
    if (good) { renderSummary(s); resetCompletedTransfer(); phase('Transfer complete.'); $('doneTitle').textContent='Transfer complete.'; $('doneText').textContent=message; panel('donePanel'); }
    else {
      recoveryRole=s.role;phase('Transfer stopped. Review the next steps below.');$('errorText').textContent=message;
      $('errorNextSteps').textContent=/verification failed/i.test(message)?'Do not continue until you confirm the other person’s identity through a trusted channel.':/connect|network|timed out|dropped|closed/i.test(message)?'Check that both devices and the host are online, then try a new code. Some networks cannot connect directly.':/checksum/i.test(message)?'Check the destination file before trying again; a mismatching file may remain.':'Check the message above and make sure both people are ready before trying again.';
      show('errorSummary',!!s.transferStarted);$('errorSummary').textContent=s.transferStarted?'Confirmed before stopping: '+formatSummary(s)+'. The last file may still have been saved.':'';
      $('recoveryGuide').open=false;show('recoverButton',s.role==='sender'||typeof window.showDirectoryPicker==='function');panel('errorPanel');
    }
  }
  function resetCompletedTransfer() {
    selectionVersion++; selection=null; $('fileInput').value=''; $('codeInput').value='';
    $('roomCode').textContent=''; $('verificationWords').textContent='';
    $('conflictPolicy').value='ask'; conflictDescription(); $('verifySaved').checked=false; $('selectionDetails').open=false;
    $('selectionPreview').textContent=''; $('selectionName').textContent=''; $('selectionDetail').textContent='';
    $('pauseStatus').textContent=''; $('pauseButton').textContent='Pause transfer'; $('pauseButton').setAttribute('aria-pressed','false');
    $('progressRoute').textContent='Connection: checking…';
    show('verificationWait',false); progress(0,1,0,''); show('notice',false); renderSelection();
  }
  function renderSummary(s) {
    const x=s.summary;
    $('summaryCompletedLabel').textContent=x.downloads?'Downloads initiated':'Files transferred';
    $('summaryCompleted').textContent=String(x.completed);$('summaryRecovered').textContent=String(x.recovered);
    $('summarySkipped').textContent=String(x.skipped);$('summaryChecked').textContent=String(x.checked);
    $('summaryElapsed').textContent=s.transferStarted?'Time: '+formatTime(Math.max(1,Math.round((Date.now()-s.transferStarted)/1000))):'';
  }
  function formatSummary(s) {
    const x=s.summary, elapsed=s.transferStarted ? Math.max(1,Math.round((Date.now()-s.transferStarted)/1000)) : 0;
    const label=x.downloads?'downloads initiated':'files transferred';
    return `${x.completed} ${label} · ${x.recovered} existing files verified and reused · ${x.skipped} skipped${x.checked ? ` · ${x.checked} saved copies checked` : ''}${elapsed ? ` · ${formatTime(elapsed)}` : ''}`;
  }
  // Streaming SHA-256 reads bounded blocks, only when recovery/verification is chosen.
  async function hashFile(file,s,label) {
    if(typeof window.VanillaWarpCreateSHA256!=='function')throw new Error('Checksum support could not load. Refresh the page.');
    const hash=window.VanillaWarpCreateSHA256(), chunkSize=4*1024*1024;let lastPaint=0;
    s.hashing=(s.hashing||0)+1;show('hashHint');$('progressSpeed').textContent='Checking files…';$('progressEta').textContent='ETA: —';
    try {
      for(let offset=0;offset<file.size;offset+=chunkSize) {
        await waitWhilePaused(s);
        const block=await file.slice(offset,Math.min(file.size,offset+chunkSize)).arrayBuffer();check(s);
        hash.update(new Uint8Array(block));
        const now=performance.now(); if(now-lastPaint>300){$('progressFile').textContent=`${label} · ${humanBytes(Math.min(file.size,offset+chunkSize))} / ${humanBytes(file.size)}`;lastPaint=now;}
        await sleep(0,s.abort.signal);
      }
      check(s);return Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('');
    } finally { s.hashing--;if(!s.hashing && session===s){show('hashHint',false);s.speedSamples=[];} }
  }
  function renderPause(s) {
    $('pauseButton').textContent=s.localPaused?'Resume transfer':'Pause transfer';
    $('pauseButton').setAttribute('aria-pressed',String(s.localPaused));
    if(s.localPaused || s.remotePaused){ $('progressSpeed').textContent='Paused'; $('progressEta').textContent='ETA: —'; s.speedSamples=[]; }
    else { s.speedSamples=[];if(s.hashing){$('progressSpeed').textContent='Checking files…';$('progressEta').textContent='ETA: —';} }
    $('pauseStatus').textContent=s.localPaused && s.remotePaused ? 'Both sides paused. Both must resume.' : s.localPaused ? 'You paused the transfer.' : s.remotePaused ? 'The other person paused the transfer.' : '';
  }
  function remotePause(s, paused) { s.remotePaused=paused; renderPause(s); }
  async function waitWhilePaused(s) {
    while(s.localPaused || s.remotePaused) await sleep(100,s.abort.signal);
    check(s);
  }
  function togglePause() {
    const s=session;
    if(!s || s.done || !s.dc || s.dc.readyState!=='open')return;
    s.localPaused=!s.localPaused;
    try { s.dc.send(s.localPaused?'PAUSE':'RESUME'); renderPause(s); }
    catch(_) { cancel(s,'Connection closed before the pause state could be shared.'); }
  }
  function cancel(s, reason='Transfer cancelled.') {
    if(!s || s.done)return;
    try { if(s.dc && s.dc.readyState==='open')s.dc.send('ERROR'); } catch(_){}
    closeSession(s,reason,false,true);
  }
  async function keepAwake(s) {
    if(s.done || s.lockPending || (wakeLock && !wakeLock.released) || document.visibilityState!=='visible')return;
    s.lockPending=true;
    try { if(!('wakeLock' in navigator))return; const lock=await navigator.wakeLock.request('screen'); if(s.done || session!==s)await lock.release(); else wakeLock=lock; } catch(_){} finally { s.lockPending=false; }
  }
  function watchConnection(s) {
    let interrupted=false;
    s.pc.onconnectionstatechange=()=>{
      if(s.done)return;
      if(s.pc.connectionState==='failed' || s.pc.connectionState==='closed') cancel(s,'Connection failed. Try another network or start a new transfer.');
      if(s.pc.connectionState==='disconnected') {interrupted=true;phase('Connection interrupted. Trying to reconnect for a few seconds…');setTimeout(()=>{ if(!s.done && s.pc.connectionState==='disconnected')cancel(s,'Connection dropped. Please start a new transfer.'); },15000);}
      if(s.pc.connectionState==='connected' && interrupted){interrupted=false;phase(s.transferStarted?'Connected again. Transfer in progress.':s.confirmed?'Connected again. Waiting for the other person to confirm.':'Connected again. Compare the words before approving.');}
    };
  }
  async function gather(s) { for(let i=0;i<50 && s.pc.iceGatheringState!=='complete';i++)await sleep(100,s.abort.signal); check(s); }
  async function post(path, body, headers, s) { return request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:s.abort.signal}); }
  async function poll(path, headers, s) {
    const deadline=Date.now()+5*60*1000;
    while(Date.now()<deadline) {
      check(s); try { return await request(path,{headers,signal:s.abort.signal}); } catch(e) { if(e.status!==404)throw e; }
      await sleep(1000,s.abort.signal);
    }
    throw new Error('Timed out waiting for the other device.');
  }
  async function ice(s, headers) {
    const result=await request('/api/ice'+codeQuery(s.code),{headers,signal:s.abort.signal});
    if (!Array.isArray(result.iceServers)) throw new Error('Invalid connection settings.');
    return result.iceServers.length ? result.iceServers : STUN;
  }
  function picker(s) {
    if (!window.showDirectoryPicker) return Promise.resolve(null);
    phase('Choose a destination folder to continue.');panel('destinationPanel');
    return new Promise((resolve,reject)=>{
      s.rejectPicker=reject;
      $('chooseDestination').onclick=async()=>{
        try { const dir=await window.showDirectoryPicker({mode:'readwrite'}); if(s.done)return; s.rejectPicker=null; $('chooseDestination').onclick=null; panel('loadingPanel'); resolve(dir); }
        catch(e) { if(e.name==='AbortError')notice('Choose a destination or cancel the transfer.'); else {s.rejectPicker=null; reject(e);} }
      };
    });
  }
  function showVerification(s, phrase) {
    if(s.done)return;
    $('verificationWords').textContent=phrase;
    $('verifyButton').textContent=s.role==='sender'?'They match · approve transfer':'They match';
    $('verifyButton').disabled=false; show('verificationWait',false); phase('Connected. Compare the words before approving.');panel('pairingPanel');
    $('verifyButton').onclick=()=>{
      if(s.done || s.confirmed)return;
      s.confirmed=true; $('verifyButton').disabled=true; show('verificationWait');phase('You confirmed. Waiting for the other person to confirm.');
      if(s.role==='receiver') { try { s.dc.send(s.verifySaved?'USER_READY_VERIFY':'USER_READY'); } catch(_){cancel(s,'Connection closed before verification.');} }
      else if(s.resolveApproval)s.resolveApproval();
    };
    $('mismatchButton').onclick=()=>cancel(s,'Verification failed. No files were sent.');
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400*30) return '—';
    if (seconds < 60) return 'less than a minute';
    if (seconds < 3600) return `${Math.ceil(seconds/60)} min`;
    return `${Math.floor(seconds/3600)} hr ${Math.ceil((seconds%3600)/60)} min`;
  }
  // Count data actually acknowledged as written, not just queued for sending.
  function progress(current,total,transferred,file) {
    const s=session, now=performance.now();
    if (s && file!=='Finished' && s.lastProgressPaint && now-s.lastProgressPaint<150) return;
    let speed=0;
    if (s) {
      s.lastProgressPaint=now;
      const samples=s.speedSamples;
      if (!(s.localPaused || s.remotePaused)) {
        samples.push({time:now,bytes:transferred});
        while (samples.length>1 && now-samples[0].time>5000) samples.shift();
        if (samples.length>1 && now>samples[0].time) speed=Math.max(0,(transferred-samples[0].bytes)*1000/(now-samples[0].time));
      }
    }
    const pct=total ? Math.min(100,Math.round(current/total*100)) : 100;
    $('progressPct').textContent=pct+'%'; $('progressBar').style.width=pct+'%'; $('progressTrack').setAttribute('aria-valuenow',String(pct));
    $('progressBytes').textContent=`${humanBytes(current)} / ${humanBytes(total)}`;
    $('progressSpeed').textContent=s && (s.localPaused || s.remotePaused) ? 'Paused' : humanBytes(speed)+'/s';
    $('progressEta').textContent='ETA: '+(speed>0 && current<total ? formatTime((total-current)/speed) : '—');
    $('progressFile').textContent=file || '';
  }
  async function updateRoute(s) {
    try {
      const stats=await s.pc.getStats(); if(s.done || session!==s)return;
      let pair=null;
      stats.forEach(x=>{if(x.type==='transport' && x.selectedCandidatePairId)pair=stats.get(x.selectedCandidatePairId)||pair;});
      if(!pair) stats.forEach(x=>{if(x.type==='candidate-pair' && x.state==='succeeded' && x.selected)pair=x;});
      if(!pair){$('progressRoute').textContent='Connection: unavailable';return;}
      const local=stats.get(pair.localCandidateId), remote=stats.get(pair.remoteCandidateId);
      let route='Connection: unknown';
      if (local && remote && local.candidateType && remote.candidateType) route=local.candidateType==='relay'||remote.candidateType==='relay'?'Connection: relay':'Connection: direct';
      if(typeof pair.currentRoundTripTime==='number' && Number.isFinite(pair.currentRoundTripTime) && pair.currentRoundTripTime>=0) route+=` · ${Math.round(pair.currentRoundTripTime*1000)} ms RTT`;
      $('progressRoute').textContent=route;
    } catch(_) { if(!s.done && session===s)$('progressRoute').textContent='Connection: unavailable'; }
  }
  function startDiagnostics(s) {
    if(s.statsTimer)return;
    if(!s.transferStarted)s.transferStarted=Date.now();
    updateRoute(s); s.statsTimer=setInterval(()=>{
      updateRoute(s);
      if(!s.done && session===s && !s.hashing && !s.localPaused && !s.remotePaused && s.lastProgressPaint && performance.now()-s.lastProgressPaint>5000) {
        $('progressSpeed').textContent=s.role==='sender'?'Waiting for receiver…':'Waiting for data…';
        $('progressEta').textContent='ETA: —'; s.speedSamples=[];
      }
    },3000);
  }
  // Conservative additive increase / multiplicative decrease. The limit always
  // bounds ciphertext waiting for disk acknowledgements to 16 MiB / 256 chunks.
  function adaptiveWindow(chunkBytes) {
    const max=Math.max(1,Math.min(256,Math.floor(16*1024*1024/(chunkBytes+28))));
    const min=Math.min(8,max); let size=Math.min(64,max), observations=0;
    return {
      get size(){return size;}, get max(){return max;},
      observe(delay,buffered) {
        if(delay>2000 || buffered>6*1024*1024) { if(++observations>=8){size=Math.max(min,Math.floor(size*0.75));observations=0;} }
        else if(delay<1000 && buffered<2*1024*1024) { observations=0; size=Math.min(max,size+1); }
        else observations=0;
      }
    };
  }
  async function waitForBuffer(s) {
    // Also bound the browser's outgoing queue; ACKs bound the receiver side.
    while(s.dc.bufferedAmount>4*1024*1024) { await waitWhilePaused(s); await sleep(20,s.abort.signal); }
    check(s);
  }
  function replies(s) {
    const pending=[];
    function rejectAll(err){while(pending.length){const p=pending.shift();clearTimeout(p.timer);p.reject(err);}}
    s.rejectReplies=rejectAll;
    s.dc.onmessage=e=>{
      if(e.data==='USER_READY' || e.data==='USER_READY_VERIFY'){ s.verifySaved=e.data==='USER_READY_VERIFY'; if(s.resolveRemoteReady){s.resolveRemoteReady();s.resolveRemoteReady=null;} return; }
      if(e.data==='ERROR'){cancel(s,'The other person cancelled or could not complete the transfer.');return;}
      if(e.data==='PAUSE' || e.data==='RESUME'){remotePause(s,e.data==='PAUSE');return;}
      const p=pending.shift(); if(!p){cancel(s,'Unexpected receiver response.');return;} clearTimeout(p.timer);p.resolve(e.data);
    };
    s.dc.onclose=()=>{if(!s.done)cancel(s,'Connection closed before completion.');};
    return (timeout=120000)=>{
      check(s);
      const p=new Promise((resolve,reject)=>{const item={resolve,reject};item.timer=setTimeout(()=>{const error=new Error('Receiver timed out.');rejectAll(error);if(!s.done)cancel(s,error.message);},timeout);pending.push(item);});
      p.catch(()=>{}); return p;
    };
  }
  function senderChannel(s, files, folder, pairing) {
    const reply=replies(s);
    const remoteReady=new Promise(resolve=>{s.resolveRemoteReady=resolve;});
    const approval=new Promise(resolve=>{s.resolveApproval=resolve;});
    s.dc.onopen=async()=>{
      try {
        const keys=await pairing; check(s); showVerification(s,keys.phrase);
        await Promise.all([approval,remoteReady]); check(s);
        keepAwake(s); phase('Both people approved. Transfer in progress.');panel('progressPanel');
        $('progressLabel').textContent='SENDING'; $('progressTitle').textContent='On its way.';
        const max=s.pc.sctp && s.pc.sctp.maxMessageSize > 0 ? s.pc.sctp.maxMessageSize : 65536;
        const chunkSize=Math.min(250*1024,max-28); if(chunkSize<1)throw new Error('Connection does not support data messages.');
        const total=files.reduce((n,f)=>n+f.size,0); if(!Number.isSafeInteger(total))throw new Error('Transfer size is too large to represent safely.');
        let acknowledged=0,skipped=0,skippedBytes=0;
        const window=adaptiveWindow(chunkSize);
        const noncePrefix=crypto.getRandomValues(new Uint8Array(4)); let chunkSequence=0;
        function nextNonce() {
          const iv=new Uint8Array(12);iv.set(noncePrefix);setUint64(new DataView(iv.buffer),4,chunkSequence++);return iv;
        }
        startDiagnostics(s);
        s.dc.send(JSON.stringify({type:'BATCH_START',count:files.length,totalSize:total,folder:!!folder}));
        if(folder) {
          const dirs=[];
          for(const path of folder.directories){await waitWhilePaused(s);const r=reply();s.dc.send(JSON.stringify({type:'DIRECTORY',path}));dirs.push(r);if(dirs.length>=Math.min(window.size,64) && await dirs.shift()!=='DIR_READY')throw new Error('Could not create destination directory.');}
          while(dirs.length)if(await dirs.shift()!=='DIR_READY')throw new Error('Could not create destination directory.');
        }
        let previousSaved=null;
        for(let i=0;i<files.length;i++) {
          await waitWhilePaused(s); const f=files[i], path=folder?folder.entries[i].path:[f.name.replace(/[/\\?%*:|"<>]/g,'_')];
          // Request the next file while the receiver finishes closing the previous
          // one. Ordered delivery preserves conflict checks and write ordering.
          const r=reply(previousSaved?24*60*60*1000:120000);s.dc.send(JSON.stringify({type:'FILE_START',path,size:f.size}));
          if(previousSaved){if(await previousSaved!=='FILE_DONE')throw new Error('File was not saved.');s.summary.completed++;if(s.verifySaved)s.summary.checked++;previousSaved=null;}
          let choice=await r;
          if(choice==='CHECKSUM_REQUEST') {
            const checksum=await hashFile(f,s,`Checking source ${f.name}`);await waitWhilePaused(s);
            const response=reply(24*60*60*1000);s.dc.send(JSON.stringify({type:'FILE_CHECKSUM',sha256:checksum}));choice=await response;
          }
          if(choice==='SKIP'||choice==='VERIFIED_SKIP'){if(choice==='VERIFIED_SKIP')s.summary.recovered++;else{s.summary.skipped++;skipped++;}skippedBytes+=f.size;progress(acknowledged+skippedBytes,total,acknowledged,`${s.summary.recovered} verified · ${s.summary.skipped} skipped`);continue;}
          if(choice!=='READY')throw new Error('Unexpected receiver response.');
          const context=f.size ? await fileContext(i,path,f.size) : null;
          const pending=[];
          async function takeAck() {
            const item=pending.shift(), result=await item.ack;
            if(result.value!=='CHUNK_OK')throw new Error('Chunk was not saved.');
            acknowledged+=item.bytes;window.observe(result.at-item.at,s.dc.bufferedAmount);
            progress(acknowledged+skippedBytes,total,acknowledged,`Sending ${f.name}`);
          }
          // Read/encrypt a few chunks concurrently, but send them in file order.
          // This queue is separate from, and much smaller than, the ACK window.
          const prepared=[]; let offset=0;
          function prefetch() {
            while(prepared.length<PREFETCH_CHUNKS && offset<f.size) {
              const start=offset,end=Math.min(f.size,start+chunkSize),iv=nextNonce();offset=end;
              const work=(async()=>{
                const chunk=await f.slice(start,end).arrayBuffer();
                const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:chunkContext(context,start)},keys.encryption,chunk);
                const payload=new Uint8Array(12+encrypted.byteLength);payload.set(iv);payload.set(new Uint8Array(encrypted),12);
                return {payload,bytes:chunk.byteLength};
              })();
              work.catch(()=>{}); prepared.push(work);
            }
          }
          await waitWhilePaused(s);prefetch();
          while(prepared.length) {
            await waitWhilePaused(s);await waitForBuffer(s);
            const item=await prepared.shift();
            await waitWhilePaused(s);await waitForBuffer(s);
            const at=performance.now(), ack=reply().then(value=>({value,at:performance.now()}));ack.catch(()=>{});
            s.dc.send(item.payload);pending.push({ack,bytes:item.bytes,at});
            while(pending.length>=window.size)await takeAck();
            await waitWhilePaused(s);prefetch();
          }
          while(pending.length)await takeAck();
          await waitWhilePaused(s);
          if(s.verifySaved) { const checksum=await hashFile(f,s,`Checking source ${f.name}`);await waitWhilePaused(s);previousSaved=reply(24*60*60*1000);s.dc.send(JSON.stringify({type:'FILE_END',sha256:checksum})); }
          else { previousSaved=reply(24*60*60*1000);s.dc.send('FILE_END'); }
        }
        if(previousSaved){if(await previousSaved!=='FILE_DONE')throw new Error('File was not saved.');s.summary.completed++;if(s.verifySaved)s.summary.checked++;}
        await waitWhilePaused(s);const completed=reply();s.dc.send('BATCH_END');const result=await completed;
        if(result!=='COMPLETE' && result!=='DOWNLOADS_STARTED')throw new Error('Receiver did not confirm completion.');
        s.summary.downloads=result==='DOWNLOADS_STARTED';
        progress(total,total,acknowledged,'Finished');
        closeSession(s,result==='DOWNLOADS_STARTED'?'Downloads were initiated. Ask the receiver to check their browser.':skipped?`${skipped} existing file(s) were skipped.`:'Your files have been sent.',true);
      } catch(e){if(!s.done)cancel(s,`Transfer stopped: ${e.message}`);}
    };
  }
  async function startSender() {
    if(!selection || !await ensureServer())return;
    let s;
    try {
      s=begin('sender'); const files=selection.files.slice(), folder=selection.folder;
      const room=await post('/api/room/create',{}, {},s); s.code=room.code;s.ownerToken=room.ownerToken;
      const pair=await makePair(); check(s);
      const iceServers=await ice(s,{'X-Owner-Token':s.ownerToken});check(s);
      s.pc=new RTCPeerConnection({iceServers});watchConnection(s);s.dc=s.pc.createDataChannel('stream',{ordered:true});
      let resolvePairing,rejectPairing;const pairing=new Promise((res,rej)=>{resolvePairing=res;rejectPairing=rej;});pairing.catch(()=>{});
      senderChannel(s,files,folder,pairing);
      await s.pc.setLocalDescription(await s.pc.createOffer());await gather(s);
      const offer={version:6,folder:!!folder,pub:pair.publicKey,sdp:{type:s.pc.localDescription.type,sdp:s.pc.localDescription.sdp}};
      await post('/api/offer'+codeQuery(s.code),offer,{'X-Owner-Token':s.ownerToken},s);
      $('roomCode').textContent=formatCode(s.code);$('waitingText').textContent='Waiting for the other person';phase('Waiting for the receiver to join and prepare to receive.');panel('codePanel');
      const answer=await poll('/api/answer'+codeQuery(s.code),{'X-Owner-Token':s.ownerToken},s);
      const keys=await pairingKeys(pair.privateKey,offer,answer,s.code,'sender');check(s);resolvePairing(keys);
      $('waitingText').textContent='Request received · connecting';phase('Receiver found. Connecting the devices…');
      await s.pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));
    } catch(e){if(s && !s.done)cancel(s,`Could not start: ${e.message}`);else if(!s)notice(e.message,true);}
  }
  async function startReceiver() {
    const code=$('codeInput').value.toUpperCase().replace(/[^A-Z2-9]/g,'');
    if(!/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$/.test(code)){notice('Enter the 8-character transfer code.',true);return;}
    if(!await ensureServer())return;
    let s;
    try {
      s=begin('receiver');s.code=code;s.verifySaved=$('verifySaved').checked;
      $('loadingText').textContent='Finding the transfer… Check the code and ask the sender to keep their tab open.';phase('Finding the sender’s transfer.');
      const offer=await poll('/api/offer'+codeQuery(code),{},s);
      if(offer.version!==6 || typeof offer.folder!=='boolean' || !offer.pub || !offer.sdp)throw new Error('Unsupported transfer version. Ask both people to refresh to the latest VanillaWarp.');
      if(offer.folder && !window.showDirectoryPicker)throw new Error('This browser cannot save complete folders directly. Use a browser with destination-folder access, such as desktop Chrome or Edge; Brave may require its File System Access setting.');
      const destination=await picker(s);check(s);
      if(!destination)notice('This browser uses downloads up to 128 MiB per file. Check your downloads after transferring.');
      $('loadingText').textContent='Connecting to the sender…';phase('Connecting to the sender’s device…');
      const joined=await post('/api/room/join'+codeQuery(code),{}, {},s);s.joinToken=joined.joinToken;
      const pair=await makePair(), iceServers=await ice(s,{'X-Join-Token':s.joinToken});check(s);
      s.pc=new RTCPeerConnection({iceServers});watchConnection(s);
      let resolvePairing;const pairing=new Promise(resolve=>{resolvePairing=resolve;});
      receiverChannel(s,pairing,destination,offer.folder,$('conflictPolicy').value);
      await s.pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      await s.pc.setLocalDescription(await s.pc.createAnswer());await gather(s);
      const answer={version:6,pub:pair.publicKey,sdp:{type:s.pc.localDescription.type,sdp:s.pc.localDescription.sdp}};
      const keys=await pairingKeys(pair.privateKey,offer,answer,code,'receiver');resolvePairing(keys);
      await post('/api/answer'+codeQuery(code),answer,{'X-Join-Token':s.joinToken},s);
    } catch(e){if(s && !s.done)cancel(s,`Could not connect: ${e.message}`);else if(!s)notice(e.message,true);}
  }
  function receiverChannel(s,pairing,destination,folder,policy) {
    s.summary.downloads=!destination;
    let writer=null,currentHandle=null,pendingCheck=null,currentName='',currentContext=null,chunks=[],expectedSize=0,fileGot=0,batchTotal=0,batchGot=0,skippedBytes=0,queue=[],queuedBytes=0,processing=false,skipped=0,folderRoot=null,started=false,expectedCount=0,filesSeen=0,declaredBytes=0,expectedChunk=0,noncePrefix=null;
    s.abortWriter=()=>writer && writer.abort?writer.abort():undefined;
    function skipCurrent(verified) {
      if(verified)s.summary.recovered++;else{skipped++;s.summary.skipped++;}
      skippedBytes+=expectedSize;s.dc.send(verified?'VERIFIED_SKIP':'SKIP');
      progress(batchGot+skippedBytes,batchTotal,batchGot,`${s.summary.recovered} verified · ${skipped} skipped`);
    }
    async function finishFile(checksum) {
      if(!writer || pendingCheck || fileGot!==expectedSize)throw new Error('Incomplete file received.');
      if(s.verifySaved ? typeof checksum!=='string'||!/^[0-9a-f]{64}$/.test(checksum) : checksum!==null)throw new Error('Invalid saved-file checksum.');
      await writer.close();writer=null;
      if(s.verifySaved) {
        if(!currentHandle)throw new Error('Saved-file verification requires a destination folder.');
        const saved=await currentHandle.getFile();
        if(saved.size!==expectedSize || await hashFile(saved,s,`Verifying saved ${currentName}`)!==checksum)throw new Error('Saved-file checksum mismatch. The saved file may remain; check or replace it.');
        const after=await currentHandle.getFile();if(after.size!==saved.size || after.lastModified!==saved.lastModified)throw new Error('Saved file changed while verifying.');
        s.summary.checked++;
      }
      currentHandle=null;s.summary.completed++;s.dc.send('FILE_DONE');
    }
    async function flush(keys) {
      if(processing||s.done)return;processing=true;
      try {
        while(queue.length && !s.done) {
          const frame=queue.shift();queuedBytes-=frame.size;const msg=frame.data;
          if(!s.confirmed)throw new Error('The sender tried to send before verification.');
          if(typeof msg==='string') {
            if(msg==='FILE_END') {
              await finishFile(null);
            } else if(msg==='BATCH_END') {
              if(!started || writer || pendingCheck || filesSeen!==expectedCount || declaredBytes!==batchTotal || (folder && !folderRoot))throw new Error('Incomplete transfer received.');
              s.summary.downloads=!destination;s.dc.send(destination?'COMPLETE':'DOWNLOADS_STARTED');progress(batchTotal,batchTotal,batchGot,'Finished');
              closeSession(s,!destination?'Downloads were initiated. Check your browser downloads.':skipped?`${skipped} existing file(s) were skipped.`:'Your files have arrived.',true,true);
            } else {
              const m=JSON.parse(msg);
              if(m.type==='FILE_END') {
                await finishFile(m.sha256);
              } else if(m.type==='FILE_CHECKSUM') {
                if(!pendingCheck || typeof m.sha256!=='string' || !/^[0-9a-f]{64}$/.test(m.sha256))throw new Error('Unexpected recovery checksum.');
                const checkFile=pendingCheck;pendingCheck=null;
                const existingHash=await checkFile.hash;check(s);
                const after=await checkFile.handle.getFile();if(after.size!==checkFile.size || after.lastModified!==checkFile.modified)throw new Error('Existing file changed while checking.');
                if(existingHash===m.sha256){currentHandle=null;skipCurrent(true);continue;}
                if(!window.confirm(`Existing file ${currentName} differs. Replace it? Cancel skips it.`)){currentHandle=null;skipCurrent(false);continue;}
                writer=await checkFile.handle.createWritable();currentHandle=checkFile.handle;s.dc.send('READY');
              } else if(m.type==='BATCH_START') {
                if(started || m.folder!==folder || !Number.isSafeInteger(m.count)||m.count<0||!Number.isSafeInteger(m.totalSize)||m.totalSize<0)throw new Error('Invalid transfer manifest.');
                started=true;expectedCount=m.count;batchTotal=m.totalSize;keepAwake(s);phase('Both people approved. Transfer in progress.');panel('progressPanel');startDiagnostics(s);$('progressLabel').textContent='RECEIVING';$('progressTitle').textContent='Coming your way.';
              } else if(m.type==='DIRECTORY'&&folder&&started) {
                validPath(m.path);if(!folderRoot){if(m.path.length!==1)throw new Error('Missing root folder.');folderRoot=m.path[0];}
                if(m.path[0]!==folderRoot)throw new Error('Path outside root folder.');await directory(destination,m.path,true);s.dc.send('DIR_READY');
              } else if(m.type==='FILE_START'&&started) {
                if(writer||pendingCheck||filesSeen>=expectedCount||!Number.isSafeInteger(m.size)||m.size<0)throw new Error('Invalid file metadata.');
                filesSeen++;declaredBytes+=m.size;if(!Number.isSafeInteger(declaredBytes)||declaredBytes>batchTotal)throw new Error('Invalid total size.');
                expectedSize=m.size;fileGot=0;const path=validPath(m.path);
                if(folder ? path.length<2||!folderRoot||path[0]!==folderRoot : path.length!==1)throw new Error('Invalid file path.');
                currentName=path.join('/');currentContext=m.size ? await fileContext(filesSeen-1,path,m.size) : null;
                if(destination) {
                  const dir=path.length>1?await directory(destination,path.slice(0,-1),false):destination;
                  let handle=null;try{handle=await dir.getFileHandle(path[path.length-1]);}catch(e){if(e.name!=='NotFoundError')throw e;}
                  if(handle && policy==='verify') {
                    const existing=await handle.getFile();
                    if(existing.size===m.size){
                      const hash=hashFile(existing,s,`Checking existing ${currentName}`);hash.catch(e=>{if(!s.done)cancel(s,`Transfer stopped: Could not check existing file: ${e.message}`);});
                      pendingCheck={handle,hash,size:existing.size,modified:existing.lastModified};s.dc.send('CHECKSUM_REQUEST');continue;
                    }
                  }
                  if(handle&&(policy==='skip'||(policy!=='replace'&&!window.confirm(`Replace existing file ${currentName}? Cancel skips it.`)))){skipCurrent(false);continue;}
                  if(!handle)handle=await dir.getFileHandle(path[path.length-1],{create:true});
                  currentHandle=handle;writer=await handle.createWritable();
                } else {
                  if(m.size>MAX_FALLBACK)throw new Error('This browser cannot stream files over 128 MiB. Use desktop Chrome or Edge.');
                  chunks=[];writer={write:async chunk=>chunks.push(chunk),close:async()=>{const url=URL.createObjectURL(new Blob(chunks));const a=document.createElement('a');a.href=url;a.download=currentName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);chunks=[];},abort:async()=>{chunks=[];}};
                }
                s.dc.send('READY');
              } else throw new Error('Unexpected transfer message.');
            }
          } else {
            if(!writer||!(msg instanceof ArrayBuffer)||msg.byteLength<28)throw new Error('Unexpected file data.');
            const iv=new Uint8Array(msg,0,12), counter=new DataView(msg,4,8);
            const sequence=counter.getUint32(0)*0x100000000+counter.getUint32(4);
            if(!Number.isSafeInteger(sequence) || sequence!==expectedChunk || (noncePrefix && !noncePrefix.every((b,i)=>b===iv[i]))) throw new Error('Out-of-order or replayed file data.');
            const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:chunkContext(currentContext,fileGot)},keys.encryption,msg.slice(12));
            if(!noncePrefix)noncePrefix=iv.slice(0,4);expectedChunk++;

            if(fileGot+decoded.byteLength>expectedSize)throw new Error('File exceeds declared size.');
            await writer.write(decoded);fileGot+=decoded.byteLength;batchGot+=decoded.byteLength;s.dc.send('CHUNK_OK');
            progress(batchGot+skippedBytes,batchTotal,batchGot,`Receiving ${currentName}`);
          }
        }
      } catch(e){if(writer&&writer.abort)try{await writer.abort();}catch(_){}if(!s.done)cancel(s,`Transfer stopped: ${e.message}`);}
      finally{processing=false;}
    }
    s.pc.ondatachannel=e=>{
      s.dc=e.channel;s.dc.binaryType='arraybuffer';
      s.dc.onopen=async()=>{try{const keys=await pairing;check(s);showVerification(s,keys.phrase);}catch(e){if(!s.done)cancel(s,`Pairing failed: ${e.message}`);}};
      s.dc.onmessage=async e=>{if(e.data==='ERROR'){if(!s.done)cancel(s,'The sender cancelled the transfer.');return;}if(e.data==='PAUSE'||e.data==='RESUME'){if(!s.confirmed){cancel(s,'Unexpected transfer control before verification.');return;}remotePause(s,e.data==='PAUSE');return;}try{
        const keys=await pairing;check(s);
        const size=typeof e.data==='string'?e.data.length*2:e.data instanceof ArrayBuffer?e.data.byteLength:Infinity;
        if(size>MAX_FRAME_BYTES || queue.length>=MAX_QUEUE_MESSAGES || queuedBytes+size>MAX_QUEUE_BYTES)throw new Error('Incoming transfer exceeded safe buffering limits.');
        queuedBytes+=size;queue.push({data:e.data,size});flush(keys);
      }catch(err){if(!s.done)cancel(s,`Transfer stopped: ${err.message}`);}};
      s.dc.onclose=()=>{if(!s.done)cancel(s,'Connection closed before completion.');};
    };
  }
  function home() { if(session){cancel(session);return;} view('homeView'); }
  function init() {
    initAppearance();
    $('homeBrand').addEventListener('click',home);document.querySelectorAll('[data-home]').forEach(x=>x.addEventListener('click',home));
    $('goSend').addEventListener('click',()=>view('sendView'));$('goReceive').addEventListener('click',()=>view('receiveView'));
    $('refreshServer').addEventListener('click',async()=>{if(!await connectServer())notice('The host is offline or the website is still publishing.',true);});
    $('noticeClose').addEventListener('click',()=>show('notice',false));
    $('filesBtn').addEventListener('click',()=>$('fileInput').click());$('folderBtn').addEventListener('click',chooseFolder);
    $('fileInput').addEventListener('change',e=>stageFiles(e.target.files));
    $('clearSelection').addEventListener('click',()=>{selectionVersion++;selection=null;$('fileInput').value='';renderSelection();});
    const drop=$('dropArea');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
    drop.addEventListener('drop',e=>{
      e.preventDefault();drop.classList.remove('over');
      if(session)return;
      const version=++selectionVersion;selection=null;renderSelection();
      // Entries must be captured synchronously while the drop event is active.
      const items=Array.from(e.dataTransfer.items||[]).filter(x=>x.kind==='file');
      const roots=items.map(x=>{const get=x.getAsEntry||x.webkitGetAsEntry;return get ? get.call(x) : null;});
      if(!roots.length||roots.some(x=>!x))return notice('This browser cannot inspect dropped items. Use Choose files or a supported folder picker.',true);
      if(roots.some(x=>x.isDirectory)) {
        if(roots.length!==1 || !roots[0].isDirectory)return notice('Drop one folder at a time, without extra files.',true);
        notice('Reading the complete folder, including empty subfolders…');
        stageDroppedFolder(roots[0],version).catch(err=>{if(version===selectionVersion&&!session)notice(`Could not read the complete folder: ${err.message}`,true);});
      } else stageFiles(e.dataTransfer.files);
    });
    $('codeInput').addEventListener('input',e=>{const c=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);e.target.value=c.length>4?formatCode(c):c;});
    $('codeInput').addEventListener('keydown',e=>{if(e.key==='Enter' && !session){e.preventDefault();$('connectBtn').click();}});
    $('conflictPolicy').addEventListener('change',conflictDescription);
    $('startSend').addEventListener('click',startSender);$('connectBtn').addEventListener('click',startReceiver);
    $('pauseButton').addEventListener('click',togglePause);
    $('cancelTop').addEventListener('click',()=>cancel(session));$('doneHome').addEventListener('click',home);$('errorHome').addEventListener('click',home);
    $('recoverButton').addEventListener('click',()=>{
      if(session)return;
      if(recoveryRole==='sender'){view('sendView');notice(selection?'Review the same selection and create a new code.':'Select the same files or folder and create a new code.');}
      else { $('codeInput').value='';$('conflictPolicy').value='verify';conflictDescription();view('receiveView');notice('Enter the new code, then choose the same destination folder.'); }
    });
    document.addEventListener('visibilitychange',()=>{if(session && session.transferStarted && document.visibilityState==='visible')keepAwake(session);});
    $('copyCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('roomCode').textContent);notice('Code copied. Share it privately.');}catch(_){notice('Copy unavailable. Select the code manually.',true);}});
    window.addEventListener('beforeunload',e=>{if(session){e.preventDefault();e.returnValue='';}});
    if (typeof window.showDirectoryPicker !== 'function') {
      $('conflictPolicy').disabled=true; $('verifySaved').disabled=true; show('conflictHelp');
      $('receiveNote').textContent='Files use browser downloads (up to 128 MiB each). Receiving complete folders needs destination-folder access.';conflictDescription();
    }
    connectServer();
  }
  window.addEventListener('DOMContentLoaded',init);
})();
