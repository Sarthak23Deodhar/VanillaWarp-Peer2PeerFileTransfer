'use strict';
// Protocol v3: ephemeral ECDH + mandatory out-of-band SAS verification.
// The room code identifies a room; it is never used as an encryption key.
(() => {
  const $ = id => document.getElementById(id);
  const WORDS = ['amber','apple','atlas','bamboo','beacon','birch','blue','bravo','cedar','cloud','coral','dawn','delta','dune','echo','fern','flame','forest','globe','gold','harbor','hazel','jade','lemon','lunar','maple','mint','ocean','olive','pearl','river','willow'];
  const STUN = [{urls:'stun:stun.cloudflare.com:3478'}];
  const MAX_FALLBACK = 128 * 1024 * 1024;
  let backend = null, online = false, selection = null, session = null, wakeLock = null;
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
  }
  function panel(name) { for (const id of ['loadingPanel','codePanel','destinationPanel','pairingPanel','progressPanel','donePanel','errorPanel']) show(id, id === name); }
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
    selection = {files:Array.from(list), folder:null}; renderSelection();
  }
  async function chooseFolder() {
    if (session) return;
    if (!window.showDirectoryPicker) { notice('Complete folder sharing needs desktop Chrome or Edge over HTTPS or localhost. File transfers still work.', true); return; }
    try {
      const root = await window.showDirectoryPicker({mode:'read'}), entries=[], directories=[];
      async function walk(dir, path) {
        directories.push(path);
        for await (const entry of dir.values()) {
          const next=path.concat(entry.name);
          if (entry.kind==='directory') await walk(entry,next);
          else if (entry.kind==='file') entries.push({file:await entry.getFile(),path:next});
          else throw new Error('Unsupported folder entry; cannot preserve the complete folder.');
        }
      }
      await walk(root,[root.name]);
      selection = {files:entries.map(x=>x.file), folder:{name:root.name,entries,directories}}; renderSelection();
    } catch(e) { if (e.name!=='AbortError') notice(`Could not read folder: ${e.message}`,true); }
  }
  function validPath(path) {
    if (!Array.isArray(path) || !path.length || path.some(p => typeof p !== 'string' || !p || p==='.' || p==='..' || /[/\\\x00-\x1f]/.test(p))) throw new Error('Invalid path received.');
    return path;
  }
  async function directory(root,path,create) { let dir=root; for (const part of validPath(path)) dir=await dir.getDirectoryHandle(part,{create}); return dir; }
  function base64(bytes) { let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function unbase64(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(text)) throw new Error('Invalid pairing key.');
    const str=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='); return Uint8Array.from(str,c=>c.charCodeAt(0));
  }
  async function makePair() {
    const keys=await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
    return {privateKey:keys.privateKey, publicKey:base64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))};
  }
  async function pairingKeys(privateKey, offer, answer, code, role) {
    if (offer.version!==3 || answer.version!==3 || typeof offer.folder!=='boolean' || !offer.sdp || offer.sdp.type!=='offer' || typeof offer.sdp.sdp!=='string' || !answer.sdp || answer.sdp.type!=='answer' || typeof answer.sdp.sdp!=='string') throw new Error('Invalid pairing details.');
    const peerPublic=await crypto.subtle.importKey('raw',unbase64(role==='sender' ? answer.pub : offer.pub),{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peerPublic},privateKey,256);
    // The transcript binds both ephemeral keys, both SDP fingerprints and the room.
    const transcript=enc.encode(JSON.stringify([3,code,offer.folder,offer.pub,answer.pub,offer.sdp.sdp,answer.sdp.sdp]));
    const salt=await crypto.subtle.digest('SHA-256',transcript);
    const root=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
    const params=info=>({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(info)});
    const encryption=await crypto.subtle.deriveKey(params('VanillaWarp v3 encryption'),root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const sasKey=await crypto.subtle.deriveKey(params('VanillaWarp v3 verification'),root,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sas=new Uint8Array(await crypto.subtle.sign('HMAC',sasKey,enc.encode('Compare these words on a trusted channel')));
    let value=(((sas[0]*0x1000000)+(sas[1]<<16)+(sas[2]<<8)+sas[3])>>>2)>>>0;
    const words=[]; for (let i=0;i<6;i++) { words.push(WORDS[value & 31]); value>>>=5; }
    return {encryption, phrase:words.join(' · ')};
  }
  function begin(role) {
    if (session) throw new Error('A transfer is already active.');
    const s={role,abort:new AbortController(),done:false,pc:null,dc:null,ownerToken:null,joinToken:null,code:null,confirmed:false,abortWriter:null,rejectPicker:null,rejectReplies:null,remoteReady:null};
    session=s; show('cancelTop'); view('sessionView'); panel('loadingPanel');
    $('sessionEyebrow').textContent=role==='sender'?'SEND / 02':'RECEIVE / 02';
    $('sessionTitle').innerHTML='Almost there<span>.</span>'; $('sessionSubtitle').textContent='Keep this page open while we connect.';
    $('loadingTitle').textContent='Getting things ready.'; $('loadingText').textContent='Connecting to the server…';
    return s;
  }
  function check(s) { if (s.done || s.abort.signal.aborted) throw new Error('Transfer cancelled.'); }
  function closeSession(s, message, good=false, delayClose=false) {
    if (!s || s.done) return;
    s.done=true;
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
    if (good) { $('doneTitle').textContent='Transfer complete.'; $('doneText').textContent=message; panel('donePanel'); }
    else { $('errorText').textContent=message; panel('errorPanel'); }
  }
  function cancel(s, reason='Transfer cancelled.') {
    if(!s || s.done)return;
    try { if(s.dc && s.dc.readyState==='open')s.dc.send('ERROR'); } catch(_){}
    closeSession(s,reason,false,true);
  }
  async function keepAwake(s) {
    try { if(!('wakeLock' in navigator))return; const lock=await navigator.wakeLock.request('screen'); if(s.done || session!==s)await lock.release(); else wakeLock=lock; } catch(_){}
  }
  function watchConnection(s) {
    s.pc.onconnectionstatechange=()=>{
      if(s.done)return;
      if(s.pc.connectionState==='failed' || s.pc.connectionState==='closed') cancel(s,'Connection failed. Try again, or ask the host to configure a free relay.');
      if(s.pc.connectionState==='disconnected') setTimeout(()=>{ if(!s.done && s.pc.connectionState==='disconnected')cancel(s,'Connection dropped. Please start a new transfer.'); },15000);
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
    panel('destinationPanel');
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
    $('verifyButton').disabled=false; show('verificationWait',false); panel('pairingPanel');
    $('verifyButton').onclick=()=>{
      if(s.done || s.confirmed)return;
      s.confirmed=true; $('verifyButton').disabled=true; show('verificationWait');
      if(s.role==='receiver') { try { s.dc.send('USER_READY'); } catch(_){cancel(s,'Connection closed before verification.');} }
      else if(s.resolveApproval)s.resolveApproval();
    };
    $('mismatchButton').onclick=()=>cancel(s,'Verification failed. No files were sent.');
  }
  function progress(current,total,speed,file) {
    const pct=total ? Math.min(100,Math.round(current/total*100)) : 100;
    $('progressPct').textContent=pct+'%'; $('progressBar').style.width=pct+'%'; $('progressTrack').setAttribute('aria-valuenow',String(pct));
    $('progressBytes').textContent=`${humanBytes(current)} / ${humanBytes(total)}`; $('progressSpeed').textContent=humanBytes(speed)+'/s'; $('progressFile').textContent=file || '';
  }
  function replies(s) {
    const pending=[];
    function rejectAll(err){while(pending.length){const p=pending.shift();clearTimeout(p.timer);p.reject(err);}}
    s.rejectReplies=rejectAll;
    s.dc.onmessage=e=>{
      if(e.data==='USER_READY'){ if(s.resolveRemoteReady){s.resolveRemoteReady();s.resolveRemoteReady=null;} return; }
      if(e.data==='ERROR'){cancel(s,'The other person cancelled or could not complete the transfer.');return;}
      const p=pending.shift(); if(!p){cancel(s,'Unexpected receiver response.');return;} clearTimeout(p.timer);p.resolve(e.data);
    };
    s.dc.onclose=()=>{if(!s.done)cancel(s,'Connection closed before completion.');};
    return ()=>{
      check(s);
      const p=new Promise((resolve,reject)=>{const item={resolve,reject};item.timer=setTimeout(()=>rejectAll(new Error('Receiver timed out.')),120000);pending.push(item);});
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
        keepAwake(s); panel('progressPanel');
        $('progressLabel').textContent='SENDING'; $('progressTitle').textContent='On its way.';
        const max=s.pc.sctp && s.pc.sctp.maxMessageSize > 0 ? s.pc.sctp.maxMessageSize : 65536;
        const chunkSize=Math.min(250*1024,max-28); if(chunkSize<1)throw new Error('Connection does not support data messages.');
        const total=files.reduce((n,f)=>n+f.size,0), t0=Date.now(); let sent=0,skipped=0,skippedBytes=0;
        s.dc.send(JSON.stringify({type:'BATCH_START',count:files.length,totalSize:total,folder:!!folder}));
        if(folder) for(const path of folder.directories){const r=reply();s.dc.send(JSON.stringify({type:'DIRECTORY',path}));if(await r!=='DIR_READY')throw new Error('Could not create destination directory.');}
        for(let i=0;i<files.length;i++) {
          check(s); const f=files[i], path=folder?folder.entries[i].path:[f.name.replace(/[/\\?%*:|"<>]/g,'_')];
          const r=reply();s.dc.send(JSON.stringify({type:'FILE_START',path,size:f.size}));const choice=await r;
          if(choice==='SKIP'){skipped++;skippedBytes+=f.size;progress(sent+skippedBytes,total,0,`${skipped} existing file(s) skipped`);continue;}
          if(choice!=='READY')throw new Error('Unexpected receiver response.');
          const pending=[];
          for(let offset=0;offset<f.size;) {
            check(s);const chunk=await f.slice(offset,offset+chunkSize).arrayBuffer();const iv=crypto.getRandomValues(new Uint8Array(12));
            const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},keys.encryption,chunk);
            const payload=new Uint8Array(12+encrypted.byteLength);payload.set(iv);payload.set(new Uint8Array(encrypted),12);
            const ack=reply();s.dc.send(payload);pending.push(ack);offset+=chunk.byteLength;sent+=chunk.byteLength;
            if(pending.length>=4 && await pending.shift()!=='CHUNK_OK')throw new Error('Chunk was not saved.');
            const elapsed=(Date.now()-t0)/1000;progress(sent+skippedBytes,total,elapsed>0?sent/elapsed:0,`Sending ${f.name}`);
          }
          while(pending.length)if(await pending.shift()!=='CHUNK_OK')throw new Error('Chunk was not saved.');
          const saved=reply();s.dc.send('FILE_END');if(await saved!=='FILE_DONE')throw new Error('File was not saved.');
        }
        const completed=reply();s.dc.send('BATCH_END');const result=await completed;
        if(result!=='COMPLETE' && result!=='DOWNLOADS_STARTED')throw new Error('Receiver did not confirm completion.');
        progress(total,total,0,'Finished');
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
      const offer={version:3,folder:!!folder,pub:pair.publicKey,sdp:{type:s.pc.localDescription.type,sdp:s.pc.localDescription.sdp}};
      await post('/api/offer'+codeQuery(s.code),offer,{'X-Owner-Token':s.ownerToken},s);
      $('roomCode').textContent=formatCode(s.code);$('waitingText').textContent='Waiting for the other person';panel('codePanel');
      const answer=await poll('/api/answer'+codeQuery(s.code),{'X-Owner-Token':s.ownerToken},s);
      const keys=await pairingKeys(pair.privateKey,offer,answer,s.code,'sender');check(s);resolvePairing(keys);
      $('waitingText').textContent='Request received · connecting';
      await s.pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));
    } catch(e){if(s && !s.done)cancel(s,`Could not start: ${e.message}`);else if(!s)notice(e.message,true);}
  }
  async function startReceiver() {
    const code=$('codeInput').value.toUpperCase().replace(/[^A-Z2-9]/g,'');
    if(!/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$/.test(code)){notice('Enter the 8-character transfer code.',true);return;}
    if(!await ensureServer())return;
    let s;
    try {
      s=begin('receiver');s.code=code;
      $('loadingText').textContent='Finding the transfer…';
      const offer=await poll('/api/offer'+codeQuery(code),{},s);
      if(offer.version!==3 || typeof offer.folder!=='boolean' || !offer.pub || !offer.sdp)throw new Error('Unsupported transfer version.');
      if(offer.folder && !window.showDirectoryPicker)throw new Error('Complete folder transfers require desktop Chrome or Edge. You can still receive individual files.');
      const destination=await picker(s);check(s);
      if(!destination)notice('This browser uses downloads up to 128 MiB per file. Check your downloads after transferring.');
      $('loadingText').textContent='Connecting to the sender…';
      const joined=await post('/api/room/join'+codeQuery(code),{}, {},s);s.joinToken=joined.joinToken;
      const pair=await makePair(), iceServers=await ice(s,{'X-Join-Token':s.joinToken});check(s);
      s.pc=new RTCPeerConnection({iceServers});watchConnection(s);
      let resolvePairing;const pairing=new Promise(resolve=>{resolvePairing=resolve;});
      receiverChannel(s,pairing,destination,offer.folder,$('conflictPolicy').value);
      await s.pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      await s.pc.setLocalDescription(await s.pc.createAnswer());await gather(s);
      const answer={version:3,pub:pair.publicKey,sdp:{type:s.pc.localDescription.type,sdp:s.pc.localDescription.sdp}};
      const keys=await pairingKeys(pair.privateKey,offer,answer,code,'receiver');resolvePairing(keys);
      await post('/api/answer'+codeQuery(code),answer,{'X-Join-Token':s.joinToken},s);
    } catch(e){if(s && !s.done)cancel(s,`Could not connect: ${e.message}`);else if(!s)notice(e.message,true);}
  }
  function receiverChannel(s,pairing,destination,folder,policy) {
    let writer=null,currentName='',chunks=[],expectedSize=0,fileGot=0,batchTotal=0,batchGot=0,skippedBytes=0,t0=0,queue=[],processing=false,skipped=0,folderRoot=null,started=false,expectedCount=0,filesSeen=0,declaredBytes=0;
    s.abortWriter=()=>writer && writer.abort?writer.abort():undefined;
    async function flush(keys) {
      if(processing||s.done)return;processing=true;
      try {
        while(queue.length && !s.done) {
          const msg=queue.shift();
          if(!s.confirmed)throw new Error('The sender tried to send before verification.');
          if(typeof msg==='string') {
            if(msg==='FILE_END') {
              if(!writer || fileGot!==expectedSize)throw new Error('Incomplete file received.');
              await writer.close();writer=null;s.dc.send('FILE_DONE');
            } else if(msg==='BATCH_END') {
              if(!started || writer || filesSeen!==expectedCount || declaredBytes!==batchTotal || (folder && !folderRoot))throw new Error('Incomplete transfer received.');
              s.dc.send(destination?'COMPLETE':'DOWNLOADS_STARTED');progress(batchTotal,batchTotal,0,'Finished');
              closeSession(s,!destination?'Downloads were initiated. Check your browser downloads.':skipped?`${skipped} existing file(s) were skipped.`:'Your files have arrived.',true,true);
            } else {
              const m=JSON.parse(msg);
              if(m.type==='BATCH_START') {
                if(started || m.folder!==folder || !Number.isSafeInteger(m.count)||m.count<0||!Number.isSafeInteger(m.totalSize)||m.totalSize<0)throw new Error('Invalid transfer manifest.');
                started=true;expectedCount=m.count;batchTotal=m.totalSize;t0=Date.now();keepAwake(s);panel('progressPanel');$('progressLabel').textContent='RECEIVING';$('progressTitle').textContent='Coming your way.';
              } else if(m.type==='DIRECTORY'&&folder&&started) {
                validPath(m.path);if(!folderRoot){if(m.path.length!==1)throw new Error('Missing root folder.');folderRoot=m.path[0];}
                if(m.path[0]!==folderRoot)throw new Error('Path outside root folder.');await directory(destination,m.path,true);s.dc.send('DIR_READY');
              } else if(m.type==='FILE_START'&&started) {
                if(writer||filesSeen>=expectedCount||!Number.isSafeInteger(m.size)||m.size<0)throw new Error('Invalid file metadata.');
                filesSeen++;declaredBytes+=m.size;if(!Number.isSafeInteger(declaredBytes)||declaredBytes>batchTotal)throw new Error('Invalid total size.');
                expectedSize=m.size;fileGot=0;const path=validPath(m.path);
                if(folder ? path.length<2||!folderRoot||path[0]!==folderRoot : path.length!==1)throw new Error('Invalid file path.');
                currentName=path.join('/');
                if(destination) {
                  const dir=path.length>1?await directory(destination,path.slice(0,-1),false):destination;
                  let exists=false;try{await dir.getFileHandle(path[path.length-1]);exists=true;}catch(e){if(e.name!=='NotFoundError')throw e;}
                  if(exists&&(policy==='skip'||(policy!=='replace'&&!window.confirm(`Replace existing file ${currentName}? Cancel skips it.`)))){skipped++;skippedBytes+=m.size;s.dc.send('SKIP');progress(batchGot+skippedBytes,batchTotal,0,`${skipped} existing file(s) skipped`);continue;}
                  const handle=await dir.getFileHandle(path[path.length-1],{create:true});writer=await handle.createWritable();
                } else {
                  if(m.size>MAX_FALLBACK)throw new Error('This browser cannot stream files over 128 MiB. Use desktop Chrome or Edge.');
                  chunks=[];writer={write:async chunk=>chunks.push(chunk),close:async()=>{const url=URL.createObjectURL(new Blob(chunks));const a=document.createElement('a');a.href=url;a.download=currentName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);chunks=[];},abort:async()=>{chunks=[];}};
                }
                s.dc.send('READY');
              } else throw new Error('Unexpected transfer message.');
            }
          } else {
            if(!writer||!(msg instanceof ArrayBuffer)||msg.byteLength<28)throw new Error('Unexpected file data.');
            const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(msg.slice(0,12))},keys.encryption,msg.slice(12));
            if(fileGot+decoded.byteLength>expectedSize)throw new Error('File exceeds declared size.');
            await writer.write(decoded);fileGot+=decoded.byteLength;batchGot+=decoded.byteLength;s.dc.send('CHUNK_OK');
            const elapsed=(Date.now()-t0)/1000;progress(batchGot+skippedBytes,batchTotal,elapsed>0?batchGot/elapsed:0,`Receiving ${currentName}`);
          }
        }
      } catch(e){if(writer&&writer.abort)try{await writer.abort();}catch(_){}if(!s.done)cancel(s,`Transfer stopped: ${e.message}`);}
      finally{processing=false;}
    }
    s.pc.ondatachannel=e=>{
      s.dc=e.channel;s.dc.binaryType='arraybuffer';
      s.dc.onopen=async()=>{try{const keys=await pairing;check(s);showVerification(s,keys.phrase);}catch(e){if(!s.done)cancel(s,`Pairing failed: ${e.message}`);}};
      s.dc.onmessage=async e=>{if(e.data==='ERROR'){if(!s.done)cancel(s,'The sender cancelled the transfer.');return;}try{const keys=await pairing;queue.push(e.data);flush(keys);}catch(err){if(!s.done)cancel(s,`Pairing failed: ${err.message}`);}};
      s.dc.onclose=()=>{if(!s.done)cancel(s,'Connection closed before completion.');};
    };
  }
  function home() { if(session){cancel(session);return;} view('homeView'); }
  function init() {
    $('homeBrand').addEventListener('click',home);document.querySelectorAll('[data-home]').forEach(x=>x.addEventListener('click',home));
    $('goSend').addEventListener('click',()=>view('sendView'));$('goReceive').addEventListener('click',()=>view('receiveView'));
    $('refreshServer').addEventListener('click',async()=>{if(!await connectServer())notice('The host is offline or the website is still publishing.',true);});
    $('noticeClose').addEventListener('click',()=>show('notice',false));
    $('filesBtn').addEventListener('click',()=>$('fileInput').click());$('folderBtn').addEventListener('click',chooseFolder);
    $('fileInput').addEventListener('change',e=>stageFiles(e.target.files));
    $('clearSelection').addEventListener('click',()=>{selection=null;$('fileInput').value='';renderSelection();});
    const drop=$('dropArea');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');const items=Array.from(e.dataTransfer.items||[]).filter(x=>x.kind==='file');if(!items.length||items.some(x=>!x.webkitGetAsEntry||!x.webkitGetAsEntry()))return notice('This browser cannot inspect dropped items. Use Choose files or Choose folder.',true);if(items.some(x=>x.webkitGetAsEntry().isDirectory))return notice('Use Choose folder to include empty folders.',true);stageFiles(e.dataTransfer.files);});
    $('codeInput').addEventListener('input',e=>{const c=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);e.target.value=c.length>4?formatCode(c):c;});
    $('startSend').addEventListener('click',startSender);$('connectBtn').addEventListener('click',startReceiver);
    $('cancelTop').addEventListener('click',()=>cancel(session));$('doneHome').addEventListener('click',home);$('errorHome').addEventListener('click',home);
    $('copyCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('roomCode').textContent);notice('Code copied. Share it privately.');}catch(_){notice('Copy unavailable. Select the code manually.',true);}});
    window.addEventListener('beforeunload',e=>{if(session){e.preventDefault();e.returnValue='';}});
    if (typeof window.showDirectoryPicker !== 'function') {
      $('conflictPolicy').disabled=true; show('conflictHelp');
      $('receiveNote').textContent='Files use browser downloads (up to 128 MiB each). Complete folders need desktop Chrome or Edge.';
    }
    connectServer();
  }
  window.addEventListener('DOMContentLoaded',init);
})();
