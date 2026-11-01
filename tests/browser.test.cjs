const test=require('node:test'), assert=require('node:assert/strict');
const base=process.env.VANILLAWARP_BROWSER_URL;
async function setup(t, viewport={width:375,height:700}) {
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
 const opts={headless:true};if(process.env.CHROME_PATH){opts.executablePath=process.env.CHROME_PATH;opts.args=['--no-sandbox','--no-zygote','--single-process'];}
 const browser=await chromium.launch(opts);t.after(()=>browser.close());const context=await browser.newContext({viewport,acceptDownloads:true});
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
   constructor(name,contents){this.kind='file';this.name=name;this.contents=contents;}
   async getFile(){return new File([new Uint8Array(this.contents)],this.name);}
   async createWritable(){const chunks=[],file=this;return{async write(buf){for (const byte of new Uint8Array(buf)) chunks.push(byte);},async close(){file.contents=chunks;},async abort(){}};}
  }
  window.testDir=new Dir(source?'Shared':'destination');
  if(source){window.testDir.children['hello.txt']=new DiskFile('hello.txt',[104,101,108,108,111]);window.testDir.children.nested=new Dir('nested');window.testDir.children.nested.children.empty=new Dir('empty');}
  if(existing)window.testDir.children['hello.txt']=new DiskFile('hello.txt',[111,108,100]);
  window.showDirectoryPicker=async()=>window.testDir;
 },{source,existing});
}
async function startPair(sender,receiver,folder=false,policy='ask') {
 await sender.goto(base);await receiver.goto(base);
 await sender.locator('#goSend').click();
 if(folder)await sender.locator('#folderBtn').click();else await sender.locator('#fileInput').setInputFiles([{name:'hello.txt',mimeType:'text/plain',buffer:Buffer.from('hello')},{name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)}]);
 await sender.locator('#startSend').click();await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});
 const code=await sender.locator('#roomCode').textContent();assert.match(code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
 await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);if(await receiver.locator('#conflictPolicy').isEnabled())await receiver.locator('#conflictPolicy').selectOption(policy);await receiver.locator('#connectBtn').click();
 if(await receiver.evaluate(()=>!!window.showDirectoryPicker)){await receiver.locator('#chooseDestination').waitFor({state:'visible',timeout:15000});await receiver.locator('#chooseDestination').click();}
 await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);
 const words=await sender.locator('#verificationWords').textContent();assert.equal(words,await receiver.locator('#verificationWords').textContent());assert.equal(words.split(' · ').length,6);
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
 const {sender,receiver}=await setup(t);await installFs(receiver,false);await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();const data=Buffer.alloc(512*1024);for(let i=0;i<data.length;i++)data[i]=i%251;await sender.locator('#fileInput').setInputFiles({name:'large.bin',mimeType:'application/octet-stream',buffer:data});await sender.locator('#startSend').click();await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);await finish(sender,receiver);const received=await receiver.evaluate(()=>window.testDir.children['large.bin'].contents);assert.deepEqual(Buffer.from(received),data);
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
 const download=receiver.waitForEvent('download',{timeout:30000});await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();const file=await download;assert.equal(file.suggestedFilename(),'hello.txt');let bytes='';for await(const chunk of await file.createReadStream())bytes+=chunk.toString();assert.equal(bytes,'hello');await receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000});assert.match(await receiver.locator('#doneText').textContent(),/Downloads were initiated/);
});
test('unsupported browser blocks folder transfer', {skip:!base,timeout:60000},async t=>{
 const {sender,receiver}=await setup(t);await installFs(sender,true);await receiver.addInitScript(()=>{window.showDirectoryPicker=undefined;});await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();await sender.locator('#folderBtn').click();await sender.locator('#startSend').click();await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#errorPanel').waitFor({state:'visible',timeout:15000});assert.match(await receiver.locator('#errorText').textContent(),/folder transfers require desktop Chrome or Edge/i);
});
test('responsive home has no horizontal overflow', {skip:!base,timeout:60000},async t=>{
 const {sender}=await setup(t);for(const size of [{width:320,height:568},{width:375,height:700},{width:1440,height:900}]){await sender.setViewportSize(size);await sender.goto(base);assert.equal(await sender.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(size));if(process.env.VANILLAWARP_SCREENSHOTS)await sender.screenshot({path:`/tmp/vanillawarp-${size.width}.png`,fullPage:true});}
});
test('Pages discovers its configured tunnel and reports stale/offline status', {skip:!base,timeout:30000},async t=>{
 const {sender}=await setup(t);const fs=require('node:fs');let serverUp=true;
 await sender.route('https://example.github.io/**',async route=>{
  const path=new URL(route.request().url()).pathname.split('/').pop()||'index.html';
  if(path==='server-config.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverUrl:'https://example.lhr.life'})});
  if(!['index.html','app.js','styles.css'].includes(path))return route.fulfill({status:404,body:'not found'});
  const types={'index.html':'text/html','app.js':'application/javascript','styles.css':'text/css'};
  return route.fulfill({status:200,contentType:types[path],body:fs.readFileSync('resources/'+path)});
 });
 await sender.route('https://example.lhr.life/**',route=>serverUp?route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://example.github.io'},body:JSON.stringify({online:true,relayConfigured:false,published:true})}):route.abort());
 await sender.goto('https://example.github.io/VanillaWarp/');await sender.getByText('Server online · direct first').waitFor({state:'visible'});serverUp=false;await sender.locator('#refreshServer').click();await sender.getByText('Server offline',{exact:true}).waitFor({state:'visible'});
});
