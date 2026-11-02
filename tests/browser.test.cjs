const test=require('node:test'), assert=require('node:assert/strict');
const base=process.env.VANILLAWARP_BROWSER_URL;
// The production server permits 10 rooms/minute, so throttle our test rooms too.
const roomStarts=[];
async function createTransfer(sender) {
 while(roomStarts.length && Date.now()-roomStarts[0]>=61000)roomStarts.shift();
 if(roomStarts.length>=9) {
  await new Promise(resolve=>setTimeout(resolve,61000-(Date.now()-roomStarts[0])));
  while(roomStarts.length && Date.now()-roomStarts[0]>=61000)roomStarts.shift();
 }
 roomStarts.push(Date.now());
 await sender.locator('#startSend').click();
}

async function setup(t, viewport={width:375,height:700}) {
 const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');const engine=process.env.VANILLAWARP_BROWSER_ENGINE||'chromium';if(!['chromium','firefox'].includes(engine))throw new Error('Unknown browser engine');
 const opts={headless:true};if(process.env.CHROME_PATH && engine==='chromium'){opts.executablePath=process.env.CHROME_PATH;opts.args=['--no-sandbox','--no-zygote','--single-process'];}
 const browser=await engines[engine].launch(opts);t.after(()=>browser.close());const context=await browser.newContext({viewport,acceptDownloads:true});
 const sender=await context.newPage(),receiver=await context.newPage();
 for(const p of [sender,receiver])p.on('pageerror',err=>console.error('PAGE ERROR:',err));
 return {sender,receiver};
}
async function installFs(page,source,existing=false) {
 await page.addInitScript(({source,existing})=>{
  class Dir {
   constructor(name){this.kind='directory';this.name=name;this.children={};}
   async *values(){yield* Object.values(this.children);}
   async getDirectoryHandle(name,opts={}){if(!this.children[name]&&opts.create)this.children[name]=new Dir(name);if(!this.children[name])throw Object.assign(new Error('not found'),{name:'NotFoundError'});if(this.children[name].kind!=='directory')throw Object.assign(new Error('type mismatch'),{name:'TypeMismatchError'});return this.children[name];}
   async getFileHandle(name,opts={}){if(!this.children[name]&&opts.create)this.children[name]=new DiskFile(name,[]);if(!this.children[name])throw Object.assign(new Error('not found'),{name:'NotFoundError'});if(this.children[name].kind!=='file')throw Object.assign(new Error('type mismatch'),{name:'TypeMismatchError'});return this.children[name];}
  }
  class DiskFile {
   constructor(name,contents){this.kind='file';this.name=name;this.contents=contents;this.modified=1;}
   async getFile(){return new File([new Uint8Array(this.contents)],this.name,{lastModified:this.modified});}
   async createWritable(){const chunks=[],file=this;return{async write(buf){if(window.testWriteDelay)await new Promise(r=>setTimeout(r,window.testWriteDelay));window.testWrites=(window.testWrites||0)+1;for (const byte of new Uint8Array(buf)) chunks.push(byte);},async close(){file.contents=chunks;file.modified++;if(window.testCorrupt&&chunks.length)file.contents[0]^=1;},async abort(){}};}
  }
  window.testDir=new Dir(source?'Shared':'destination');
  if(source){window.testDir.children['hello.txt']=new DiskFile('hello.txt',[104,101,108,108,111]);window.testDir.children.nested=new Dir('nested');window.testDir.children.nested.children.empty=new Dir('empty');}
  if(existing)window.testDir.children['hello.txt']=new DiskFile('hello.txt',[111,108,100]);
  window.showDirectoryPicker=async()=>window.testDir;
 },{source,existing});
}
async function startPair(sender,receiver,folder=false,policy='ask',verify=false,onCode=null) {
 await sender.goto(base);await receiver.goto(base);
 await sender.locator('#goSend').click();
 if(folder)await sender.locator('#folderBtn').click();else await sender.locator('#fileInput').setInputFiles([{name:'hello.txt',mimeType:'text/plain',buffer:Buffer.from('hello')},{name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)}]);
 await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});
 const code=await sender.locator('#roomCode').textContent();assert.match(code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);if(onCode)await onCode(sender,code);
 await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);if(await receiver.locator('#conflictPolicy').isEnabled())await receiver.locator('#conflictPolicy').selectOption(policy);if(verify)await receiver.locator('#verifySaved').check();await receiver.locator('#connectBtn').click();
 if(await receiver.evaluate(()=>!!window.showDirectoryPicker)){await receiver.locator('#chooseDestination').waitFor({state:'visible',timeout:15000});await receiver.locator('#chooseDestination').click();}
 await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);
 const words=await sender.locator('#verificationWords').textContent();assert.equal(words,await receiver.locator('#verificationWords').textContent());assert.equal(words.split(' · ').length,8);
}
async function finish(sender,receiver){
 await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
 try { await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:15000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:15000})]); } catch(e) { throw new Error(`${e.message} | sender: ${await sender.locator('#errorText').textContent()} | receiver: ${await receiver.locator('#errorText').textContent()}`); }
}
test('real WebRTC transfer waits for BOTH confirmations and handles empty files', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await startPair(sender,receiver);
 await sender.locator('#verifyButton').click();await receiver.waitForTimeout(600);
 assert.equal(await receiver.evaluate(()=>Object.keys(window.testDir.children).length),0,'no metadata/content before receiver confirmation');
 await receiver.locator('#verifyButton').click();await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000})]);
 assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents),[104,101,108,108,111]);assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['empty.txt'].contents),[]);
});
test('real WebRTC transfers multiple encrypted chunks with bounded acknowledgements', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();const data=Buffer.alloc(512*1024);for(let i=0;i<data.length;i++)data[i]=i%251;await sender.locator('#fileInput').setInputFiles({name:'large.bin',mimeType:'application/octet-stream',buffer:data});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await finish(sender,receiver);const received=await receiver.evaluate(()=>window.testDir.children['large.bin'].contents);assert.deepEqual(Buffer.from(received),data);
});
test('real WebRTC preserves nested empty folders', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t,{width:1280,height:800});await installFs(sender,true);await installFs(receiver,false);await startPair(sender,receiver,true);await finish(sender,receiver);
 assert.deepEqual(await receiver.evaluate(()=>window.testDir.children.Shared.children['hello.txt'].contents),[104,101,108,108,111]);assert.equal(await receiver.evaluate(()=>window.testDir.children.Shared.children.nested.children.empty.kind),'directory');
});
test('existing file skip policy preserves old contents', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);await startPair(sender,receiver,false,'skip');await finish(sender,receiver);
 assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents),[111,108,100]);assert.match(await receiver.locator('#doneText').textContent(),/skipped/);
});
test('ask policy prompts before replacing an existing file', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);let asked=false;receiver.on('dialog',async dialog=>{asked=true;assert.match(dialog.message(),/Replace existing file hello.txt/);await dialog.accept();});await startPair(sender,receiver);await finish(sender,receiver);assert.ok(asked);assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents),[104,101,108,108,111]);
});
test('verification mismatch cancels without writing files', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await startPair(sender,receiver);await receiver.locator('#mismatchButton').click();await receiver.locator('#errorPanel').waitFor({state:'visible'});await sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.equal(await receiver.evaluate(()=>Object.keys(window.testDir.children).length),0);
});
test('file download fallback describes browser download accurately', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await receiver.addInitScript(()=>{window.showDirectoryPicker=undefined;});await startPair(sender,receiver);
 assert.equal(await receiver.locator('#verifySaved').isDisabled(),true);assert.match(await receiver.locator('#conflictDescription').textContent(),/browser manages download conflicts/i);
 const download=receiver.waitForEvent('download',{timeout:30000});await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();const file=await download;assert.equal(file.suggestedFilename(),'hello.txt');let bytes='';for await(const chunk of await file.createReadStream())bytes+=chunk.toString();assert.equal(bytes,'hello');await receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000});assert.match(await receiver.locator('#doneText').textContent(),/Downloads were initiated/);assert.equal(await receiver.locator('#summaryCompletedLabel').textContent(),'Downloads initiated');
});
test('unsupported browser blocks folder transfer', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(sender,true);await receiver.addInitScript(()=>{window.showDirectoryPicker=undefined;});await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#folderBtn').click();await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.match(await receiver.locator('#errorText').textContent(),/cannot save complete folders directly/i);
});
test('responsive home has no horizontal overflow', {skip:!base,timeout:60000},async t=>{
 const {sender}=await setup(t);for(const size of [{width:320,height:568},{width:375,height:700},{width:1440,height:900}]){await sender.setViewportSize(size);await sender.goto(base);assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(size));if(process.env.VANILLAWARP_SCREENSHOTS)await sender.screenshot({path:`/tmp/vanillawarp-${size.width}.png`,fullPage:true});if(size.width===320){await sender.locator('#goSend').click();await sender.getByText('Folder support in Brave and Firefox').click();assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await sender.locator('[data-home]').first().click();await sender.locator('#goReceive').click();await sender.getByText('Having trouble receiving a folder?').click();assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}}
});
test('Pages discovers its configured tunnel and reports stale/offline status', {skip:!base,timeout:30000},async t=>{
 const {sender}=await setup(t);const fs=require('node:fs');let serverUp=true;
 await sender.route('https://example.github.io/**',async route=>{
  const path=new URL(route.request().url()).pathname.split('/').pop()||'index.html';
  if(path==='server-config.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverUrl:'https://example.lhr.life'})});
  if(!['index.html','app.js','hash.js','styles.css'].includes(path))return route.fulfill({status:404,body:'not found'});
  const types={'index.html':'text/html','app.js':'application/javascript','hash.js':'application/javascript','styles.css':'text/css'};
  return route.fulfill({status:200,contentType:types[path],body:fs.readFileSync('resources/'+path)});
 });
 await sender.route('https://example.lhr.life/**',route=>serverUp?route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://example.github.io'},body:JSON.stringify({online:true,relayConfigured:false,published:true})}):route.abort());
 await sender.goto('https://example.github.io/VanillaWarp/');await sender.getByText('Server online · direct first').waitFor({state:'visible'});serverUp=false;await sender.locator('#refreshServer').click();await sender.getByText('Server offline',{exact:true}).waitFor({state:'visible'});
});
test('successful transfer clears selection, code, words, and conflict policy on both sides', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);await startPair(sender,receiver,false,'skip');await finish(sender,receiver);
 for(const page of [sender,receiver]){
  assert.equal(await page.locator('#roomCode').textContent(),'');assert.equal(await page.locator('#verificationWords').textContent(),'');assert.equal(await page.locator('#codeInput').inputValue(),'');assert.equal(await page.locator('#conflictPolicy').inputValue(),'ask');
 }
 await sender.locator('#doneHome').click();await sender.locator('#goSend').click();assert.equal(await sender.locator('#startSend').isDisabled(),true);assert.equal(await sender.locator('#selection').isHidden(),true);
});
test('dropped folder entries include nested empty folders and preserve file data', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await sender.addInitScript(()=>{window.showDirectoryPicker=undefined;});await installFs(receiver,false);
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();
 await sender.evaluate(()=>{
  const file={name:'hello.txt',isFile:true,isDirectory:false,file(ok){ok(new File(['hello'],'hello.txt'));}};
  const dir=(name,children)=>({name,isDirectory:true,isFile:false,createReader(){let i=0;return{readEntries(ok){ok(i<children.length?[children[i++]]:[]);}};}});
  const root=dir('Shared',[file,dir('nested',[dir('empty',[])])]);const event=new Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>root}],files:[]}});document.querySelector('#dropArea').dispatchEvent(event);
 });
 await sender.locator('#selection').waitFor({state:'visible'});assert.match(await sender.locator('#selectionPreview').textContent(),/Shared\/nested\/empty\//);
 await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await finish(sender,receiver);
 assert.equal(await receiver.evaluate(()=>window.testDir.children.Shared.children.nested.children.empty.kind),'directory');assert.deepEqual(await receiver.evaluate(()=>window.testDir.children.Shared.children['hello.txt'].contents),[104,101,108,108,111]);
});
test('either participant can pause; both must resume, then transfer completes', {skip:!base,timeout:90000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=35;});
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();const data=Buffer.alloc(6*1024*1024,42);await sender.locator('#fileInput').setInputFiles({name:'large.bin',buffer:data});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);
 await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await receiver.locator('#progressPanel').waitFor({state:'visible',timeout:10000});await receiver.locator('#pauseButton').click();await sender.getByText('The other person paused the transfer.').waitFor({state:'visible'});
 await sender.locator('#pauseButton').click();await receiver.getByText('Both sides paused. Both must resume.').waitFor({state:'visible'});await receiver.locator('#pauseButton').click();await sender.getByText('You paused the transfer.').waitFor({state:'visible'});
 await receiver.waitForTimeout(4000);const before=await receiver.locator('#progressBytes').textContent();await receiver.waitForTimeout(700);assert.equal(await receiver.locator('#progressBytes').textContent(),before,'in-flight chunks should drain and remain paused');assert.equal(await receiver.locator('#donePanel').isHidden(),true);
 await sender.locator('#pauseButton').click();await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000})]);assert.equal(await receiver.evaluate(()=>window.testDir.children['large.bin'].contents.length),data.length);assert.equal(await receiver.evaluate(()=>window.testDir.children['large.bin'].contents.every(x=>x===42)),true);
});
test('failed folder enumeration clears any old selection and never sends a partial folder', {skip:!base,timeout:30000},async t=>{
 const {sender}=await setup(t);await sender.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles({name:'old.txt',buffer:Buffer.from('old')});
 await sender.evaluate(()=>{const bad={name:'incomplete',isDirectory:true,isFile:false,createReader(){return{readEntries(ok,fail){fail(new Error('directory read failed'));}};}};const e=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>bad}],files:[]}});document.querySelector('#dropArea').dispatchEvent(e);});
 await sender.getByText(/Could not read the complete folder/).waitFor({state:'visible'});assert.equal(await sender.locator('#startSend').isDisabled(),true);assert.equal(await sender.locator('#selection').isHidden(),true);
});
test('bounded window sends more than four chunks before a slow disk acknowledges the first', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=3000;});
 await sender.addInitScript(()=>{window.wireChunks=0;const original=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(typeof data!=='string')window.wireChunks++;return original.call(this,data);};});
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles({name:'window.bin',buffer:Buffer.alloc(3*1024*1024,1)});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);
 await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await sender.waitForFunction(()=>window.wireChunks>=8,null,{timeout:10000});assert.equal(await receiver.evaluate(()=>window.testWrites||0),0);await sender.locator('#cancelTop').click();await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000});
});
test('pipelined file starts still ask for each repeated existing name', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);let asks=0;receiver.on('dialog',async d=>{asks++;await d.accept();});
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles([{name:'hello.txt',buffer:Buffer.from('first')},{name:'hello.txt',buffer:Buffer.from('second')}]);await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await finish(sender,receiver);
 assert.equal(asks,2);assert.equal(Buffer.from(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents)).toString(),'second');
});
test('connection diagnostics distinguish direct and relay reports', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=100;});
 await sender.addInitScript(()=>{RTCPeerConnection.prototype.getStats=async()=>new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{type:'candidate-pair',localCandidateId:'l',remoteCandidateId:'r',currentRoundTripTime:0.025}],['l',{candidateType:'host'}],['r',{candidateType:'srflx'}]]);});
 await receiver.addInitScript(()=>{RTCPeerConnection.prototype.getStats=async()=>new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{type:'candidate-pair',localCandidateId:'l',remoteCandidateId:'r'}],['l',{candidateType:'relay'}],['r',{candidateType:'host'}]]);});
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles({name:'stats.bin',buffer:Buffer.alloc(2*1024*1024)});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
 await sender.locator('#progressDetails summary').click();await receiver.locator('#progressDetails summary').click();
 await sender.getByText('Connection: direct · 25 ms RTT').waitFor({state:'visible',timeout:10000});await receiver.getByText('Connection: relay').waitFor({state:'visible',timeout:10000});await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000})]);
});
test('large multi-window transfer preserves exact byte order with parallel encryption', {skip:!base,timeout:90000},async t=>{
 const {sender,receiver}=await setup(t);const crypto=require('node:crypto');
 await sender.addInitScript(()=>{window.sentNonces=[];const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(ArrayBuffer.isView(data))window.sentNonces.push(Array.from(new Uint8Array(data.buffer,data.byteOffset,12)));return send.call(this,data);};});
 await receiver.addInitScript(()=>{window.receivedDigest='';window.showDirectoryPicker=async()=>({async getFileHandle(name,opts={}){if(!opts.create)throw Object.assign(new Error('not found'),{name:'NotFoundError'});return{async createWritable(){const chunks=[];return{async write(data){chunks.push(new Uint8Array(data));},async close(){const all=new Uint8Array(chunks.reduce((n,x)=>n+x.length,0));let off=0;for(const chunk of chunks){all.set(chunk,off);off+=chunk.length;}const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',all));window.receivedDigest=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');},async abort(){}};}};}});});
 const data=Buffer.alloc(20*1024*1024);for(let i=0;i<data.length;i++)data[i]=((i*7)^(i>>>10))&255;const expected=crypto.createHash('sha256').update(data).digest('hex');
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles({name:'integrity.bin',buffer:data});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await finish(sender,receiver);assert.equal(await receiver.evaluate(()=>window.receivedDigest),expected);
 const nonces=await sender.evaluate(()=>window.sentNonces);assert.ok(nonces.length>64);assert.equal(new Set(nonces.map(n=>Buffer.from(n).toString('hex'))).size,nonces.length);for(let i=0;i<nonces.length;i++){const iv=Buffer.from(nonces[i]);assert.deepEqual(iv.subarray(0,4),Buffer.from(nonces[0]).subarray(0,4));assert.equal(iv.readBigUInt64BE(4),BigInt(i));}
});
test('stalled receiver times out and cancels without hanging the sender', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);
 await sender.addInitScript(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===120000?600:ms,...args);});
 await receiver.addInitScript(()=>{const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(data==='CHUNK_OK')return;return send.call(this,data);};});
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles({name:'stalled.bin',buffer:Buffer.alloc(2*1024*1024,7)});await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await sender.locator('#errorPanel').waitFor({state:'visible',timeout:10000});assert.match(await sender.locator('#errorText').textContent(),/Receiver timed out/);await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:10000});
});
async function tamperCase(t,mode){
 const {sender,receiver}=await setup(t);await installFs(receiver,false);
 await sender.addInitScript(mode=>{
  let changed=false;const send=RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send=function(data){
   if(!changed&&mode==='metadata'&&typeof data==='string'&&data.startsWith('{')){let obj=JSON.parse(data);if(obj.type==='FILE_START'){changed=true;obj.path=['modified.txt'];data=JSON.stringify(obj);}}
   if(!changed&&ArrayBuffer.isView(data)){
    changed=true;const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();
    if(mode==='ciphertext')bytes[bytes.length-1]^=1;
    if(mode==='replay'){send.call(this,bytes);return send.call(this,bytes);}
    data=bytes;
   }
   return send.call(this,data);
  };
 },mode);
 await startPair(sender,receiver);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
 await Promise.all([sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000}),receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000})]);
 assert.match(await receiver.locator('#errorText').textContent(),mode==='replay'?/replayed file data/i:/Transfer stopped/);
 assert.equal(await receiver.evaluate(()=>Object.values(window.testDir.children).every(x=>x.contents.length===0)),true);
}
test('tampered ciphertext is rejected without committing file bytes', {skip:!base,timeout:60000},async t=>tamperCase(t,'ciphertext'));
test('replayed chunk is rejected without committing file bytes', {skip:!base,timeout:60000},async t=>tamperCase(t,'replay'));
test('tampered file path is detected by authenticated chunk metadata', {skip:!base,timeout:60000},async t=>tamperCase(t,'metadata'));
test('receiver bounds its incoming queue when a peer floods messages', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=3000;});
 await sender.addInitScript(()=>{let flooded=false;const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(!flooded&&ArrayBuffer.isView(data)){flooded=true;send.call(this,data);for(let i=0;i<600;i++)send.call(this,'{"type":"unexpected"}');return;}return send.call(this,data);};});
 await startPair(sender,receiver);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.match(await receiver.locator('#errorText').textContent(),/safe buffering limits/);
});
test('CSP blocks injected inline script in the local interface', {skip:!base,timeout:30000},async t=>{
 const {sender}=await setup(t);await sender.goto(base);await sender.evaluate(()=>{const el=document.createElement('script');el.textContent='window.untrustedInlineRan=true';document.body.appendChild(el);});await sender.waitForTimeout(100);assert.equal(await sender.evaluate(()=>!!window.untrustedInlineRan),false);
});
test('malicious traversal paths are rejected before opening a file', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);
 await sender.addInitScript(()=>{let changed=false;const send=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(!changed&&typeof data==='string'&&data.startsWith('{')){const m=JSON.parse(data);if(m.type==='FILE_START'){changed=true;m.path=['..','outside.txt'];data=JSON.stringify(m);}}return send.call(this,data);};});
 await startPair(sender,receiver);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.match(await receiver.locator('#errorText').textContent(),/Invalid path/);assert.equal(await receiver.evaluate(()=>Object.keys(window.testDir.children).length),0);
});
test('optional saved-file SHA-256 verifies written files and reports a summary', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await startPair(sender,receiver,false,'ask',true);await finish(sender,receiver);
 assert.equal(await sender.locator('#summaryChecked').textContent(),'2');assert.equal(await receiver.locator('#summaryChecked').textContent(),'2');assert.equal(await receiver.locator('#verifySaved').isChecked(),false);
});
test('saved-file checksum mismatch stops instead of reporting success', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testCorrupt=true;});await startPair(sender,receiver,false,'ask',true);
 await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await Promise.all([sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000}),receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000})]);assert.match(await receiver.locator('#errorText').textContent(),/checksum mismatch/i);assert.equal(await receiver.locator('#donePanel').isHidden(),true);
});
test('recovery verifies existing matching files and transfers only missing files', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);await receiver.addInitScript(()=>{window.testDir.children['hello.txt'].contents=[104,101,108,108,111];});await startPair(sender,receiver,false,'verify');await finish(sender,receiver);
 assert.equal(await receiver.locator('#summaryRecovered').textContent(),'1');assert.equal(await sender.locator('#summaryRecovered').textContent(),'1');assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['empty.txt'].contents),[]);
});
test('recovery asks before replacing a same-size file with different content', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);await receiver.addInitScript(()=>{window.testDir.children['hello.txt'].contents=[119,111,114,108,100];});let asks=0;receiver.on('dialog',async d=>{asks++;assert.match(d.message(),/differs/);await d.dismiss();});await startPair(sender,receiver,false,'verify');await finish(sender,receiver);
 assert.equal(asks,1);assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents),[119,111,114,108,100]);assert.equal(await receiver.locator('#summarySkipped').textContent(),'1');
});
test('interrupted transfer retries with fresh verification and reuses only checksum-matched files', {skip:!base,timeout:90000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=55;});receiver.on('dialog',async d=>d.accept());
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles([{name:'first.txt',buffer:Buffer.from('complete')},{name:'large.bin',buffer:Buffer.alloc(2*1024*1024,3)}]);await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const firstCode=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(firstCode);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
 await receiver.waitForFunction(()=>window.testDir.children['first.txt']?.contents.length===8 && !!window.testDir.children['large.bin'],null,{timeout:15000});await sender.locator('#cancelTop').click();await Promise.all([sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000}),receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000})]);assert.equal(Buffer.from(await receiver.evaluate(()=>window.testDir.children['first.txt'].contents)).toString(),'complete');
 assert.match(await sender.locator('#errorSummary').textContent(),/Confirmed before stopping/);await sender.locator('#recoverButton').click();await receiver.locator('#recoverButton').click();assert.equal(await receiver.locator('#codeInput').inputValue(),'');assert.equal(await receiver.locator('#conflictPolicy').inputValue(),'verify');assert.match(await sender.locator('#selectionDetail').textContent(),/2 files/);await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const secondCode=await sender.locator('#roomCode').textContent();assert.notEqual(firstCode,secondCode);await receiver.locator('#codeInput').fill(secondCode);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);assert.equal(await sender.locator('#verificationWords').textContent(),await receiver.locator('#verificationWords').textContent());await finish(sender,receiver);
 assert.equal(await receiver.locator('#summaryRecovered').textContent(),'1');assert.equal(await receiver.evaluate(()=>window.testDir.children['large.bin'].contents.length),2*1024*1024);
});
test('cancelling during recovery hashing leaves existing content untouched', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await receiver.addInitScript(()=>{
  const data=new Uint8Array(20*1024*1024);data.fill(7);window.testDir.children['hello.txt']={kind:'file',name:'hello.txt',getFile:async()=>new File([data],'hello.txt'),createWritable:async()=>{window.testOverwritten=true;throw new Error('must not overwrite');}};
  window.addEventListener('DOMContentLoaded',()=>{const create=window.VanillaWarpCreateSHA256;window.VanillaWarpCreateSHA256=()=>{const hash=create();return {update(bytes){window.testHashStarted=true;const end=performance.now()+30;while(performance.now()<end){}return hash.update(bytes);},digest(){return hash.digest();}};};});
 });
 await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#fileInput').setInputFiles([{name:'hello.txt',buffer:Buffer.alloc(20*1024*1024,7)}]);await createTransfer(sender);await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#conflictPolicy').selectOption('verify');await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
 await receiver.waitForFunction(()=>window.testHashStarted,null,{timeout:15000});await receiver.locator('#cancelTop').click();await Promise.all([sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000}),receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000})]);assert.equal(await receiver.evaluate(()=>!!window.testOverwritten),false);assert.equal(await receiver.locator('#donePanel').isHidden(),true);
});
test('recovery asks before replacing a differently sized existing file', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false,true);let asks=0;receiver.on('dialog',async d=>{asks++;assert.match(d.message(),/Replace existing file/);await d.accept();});await startPair(sender,receiver,false,'verify');await finish(sender,receiver);
 assert.equal(asks,1);assert.deepEqual(await receiver.evaluate(()=>window.testDir.children['hello.txt'].contents),[104,101,108,108,111]);assert.equal(await receiver.locator('#summaryRecovered').textContent(),'0');
});
test('default fast path does not hash or reread saved files', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(receiver,false);
 for(const page of [sender,receiver])await page.addInitScript(()=>window.addEventListener('DOMContentLoaded',()=>{const create=window.VanillaWarpCreateSHA256;window.VanillaWarpCreateSHA256=()=>{window.testHashCalls=(window.testHashCalls||0)+1;return create();};}));
 await receiver.addInitScript(()=>{const get=window.testDir.getFileHandle.bind(window.testDir);window.testDir.getFileHandle=async(...args)=>{const handle=await get(...args);const original=handle.getFile.bind(handle);handle.getFile=async()=>{window.testSavedReads=(window.testSavedReads||0)+1;return original();};return handle;};});
 await startPair(sender,receiver);await finish(sender,receiver);assert.equal(await sender.evaluate(()=>window.testHashCalls||0),0);assert.equal(await receiver.evaluate(()=>window.testHashCalls||0),0);assert.equal(await receiver.evaluate(()=>window.testSavedReads||0),0);
});
test('UX policy explanations, mobile entry and keyboard focus are clear', {skip:!base,timeout:45000},async t=>{
 const {sender}=await setup(t);await installFs(sender,false);await sender.goto(base);await sender.locator('#goReceive').click();
 await sender.waitForFunction(()=>document.activeElement===document.querySelector('#receiveView h1'));
 await sender.locator('#conflictPolicy').selectOption('replace');await sender.getByText(/replaced without further prompts/).waitFor({state:'visible'});
 await sender.locator('#conflictPolicy').selectOption('verify');await sender.getByText(/Partial files restart/).first().waitFor({state:'visible'});
 await sender.locator('#codeInput').fill('abcd2345');assert.equal(await sender.locator('#codeInput').inputValue(),'ABCD-2345');assert.equal(await sender.locator('#codeInput').getAttribute('autocapitalize'),'characters');
 for(const selector of ['#connectBtn','#refreshServer']) {const box=await sender.locator(selector).boundingBox();assert.ok(box.height>=44,selector);}
 await sender.emulateMedia({reducedMotion:'reduce'});assert.ok(await sender.locator('#connectBtn').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))<=0.001);
 await sender.locator('#receiveView .preparation-guide summary').click();await sender.getByText(/possible browser temporary files/).waitFor({state:'visible'});assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('UX accessibility checks cover desktop and mobile main views', {skip:!base,timeout:60000},async t=>{
 const {sender}=await setup(t);const AxeBuilder=require('@axe-core/playwright').default;
 for(const viewport of [{width:375,height:700},{width:1440,height:900}]){
  await sender.setViewportSize(viewport);await sender.goto(base);
  for(const state of ['home','send','receive']){
   if(state==='send')await sender.locator('#goSend').click();if(state==='receive'){await sender.locator('#sendView [data-home]').click();await sender.locator('#goReceive').click();}
   const result=await new AxeBuilder({page:sender}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`${state} ${viewport.width}`);
   assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
 }
});
test('UX connection stages, pairing, errors and recovery are accessible', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await receiver.emulateMedia({colorScheme:'dark'});await installFs(receiver,false);await startPair(sender,receiver);const AxeBuilder=require('@axe-core/playwright').default;
 assert.equal(await sender.locator('#transferSteps [aria-current=step]').getAttribute('data-stage'),'verify');assert.equal(await receiver.locator('#transferSteps [aria-current=step]').getAttribute('data-stage'),'verify');assert.match(await sender.locator('#sessionSubtitle').textContent(),/Compare the words/);assert.match(await receiver.locator('#sessionSubtitle').textContent(),/Compare the words/);
 for(const page of [sender,receiver]){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);}
 await receiver.locator('#mismatchButton').click();await receiver.locator('#errorPanel').waitFor({state:'visible'});await sender.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.match(await receiver.locator('#errorNextSteps').textContent(),/trusted channel/);assert.equal(await receiver.locator('#transferSteps [aria-current=step]').getAttribute('aria-label'),'Verify, stopped');
 const result=await new AxeBuilder({page:receiver}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
 await receiver.locator('#recoveryGuide summary').click();assert.match(await receiver.locator('#recoveryGuide').textContent(),/incomplete files restart/i);await receiver.locator('#recoverButton').click();assert.equal(await receiver.locator('#conflictPolicy').inputValue(),'verify');assert.equal(await receiver.locator('#codeInput').inputValue(),'');
});
test('UX progress details, completion and copy feedback are accessible', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await receiver.emulateMedia({colorScheme:'dark'});await installFs(receiver,false);await receiver.addInitScript(()=>{window.testWriteDelay=2500;});await sender.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.testCopyFail)throw new Error('denied');window.copiedCode=text;}}});});await startPair(sender,receiver,false,'ask',false,async(page,code)=>{assert.match(await page.locator('#sessionSubtitle').textContent(),/Waiting for the receiver/);assert.equal(await page.locator('#transferSteps [aria-current=step]').getAttribute('data-stage'),'connect');await page.locator('#copyCode').click();assert.equal(await page.evaluate(()=>window.copiedCode),code);assert.match(await page.locator('#noticeText').textContent(),/Code copied/);await page.evaluate(()=>window.testCopyFail=true);await page.locator('#copyCode').click();assert.match(await page.locator('#noticeText').textContent(),/Copy unavailable/);});
 await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();await sender.locator('#progressPanel').waitFor({state:'visible',timeout:10000});assert.equal(await sender.locator('#transferSteps [aria-current=step]').getAttribute('data-stage'),'transfer');await sender.locator('#progressDetails summary').click();
 const AxeBuilder=require('@axe-core/playwright').default;for(const page of [sender,receiver]){await page.locator('#progressPanel').waitFor({state:'visible',timeout:10000});const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);}
 await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:20000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:20000})]);assert.equal(await receiver.locator('#transferSteps [aria-current=step]').getAttribute('data-stage'),'complete');assert.equal(await receiver.locator('#summaryCompleted').textContent(),'2');const result=await new AxeBuilder({page:receiver}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
});
test('frontend theme follows system, persists a choice and handles blocked storage', {skip:!base,timeout:45000},async t=>{
 const {sender,receiver}=await setup(t);await sender.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await sender.goto(base);
 assert.equal(await sender.locator('html').getAttribute('data-theme'),'dark');assert.equal(await sender.locator('#themeToggle').getAttribute('aria-pressed'),'true');assert.equal(await sender.evaluate(()=>document.documentElement.classList.contains('show-splash')),false);
 await sender.locator('#themeToggle').click();assert.equal(await sender.locator('html').getAttribute('data-theme'),'light');assert.equal(await sender.locator('#themeToggle').getAttribute('aria-pressed'),'false');await sender.reload();assert.equal(await sender.locator('html').getAttribute('data-theme'),'light');
 await receiver.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked');}});});await receiver.goto(base);await receiver.locator('#themeToggle').click();assert.equal(await receiver.locator('html').getAttribute('data-theme'),'dark');
});
test('frontend splash is brief, decorative and never blocks interaction', {skip:!base,timeout:45000},async t=>{
 const {sender}=await setup(t);await sender.emulateMedia({reducedMotion:'no-preference'});await sender.goto(base);
 assert.equal(await sender.locator('#splash').getAttribute('aria-hidden'),'true');assert.equal(await sender.locator('#splash').evaluate(el=>getComputedStyle(el).pointerEvents),'none');await sender.locator('#goReceive').click();assert.equal(await sender.locator('#receiveView').isVisible(),true);
 await sender.waitForFunction(()=>!document.documentElement.classList.contains('show-splash'),null,{timeout:3000});assert.equal(await sender.locator('#splash').isHidden(),true);
});
test('frontend dark theme preserves accessibility on desktop and mobile', {skip:!base,timeout:60000},async t=>{
 const {sender}=await setup(t);const AxeBuilder=require('@axe-core/playwright').default;await sender.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
 for(const viewport of [{width:320,height:700},{width:1440,height:900}]){
  await sender.setViewportSize(viewport);await sender.goto(base);assert.equal(await sender.locator('html').getAttribute('data-theme'),'dark');
  for(const state of ['home','send','receive']){
   if(state==='send')await sender.locator('#goSend').click();if(state==='receive'){await sender.locator('#sendView [data-home]').click();await sender.locator('#goReceive').click();}
   const result=await new AxeBuilder({page:sender}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`${state} ${viewport.width}`);assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
 }
});
