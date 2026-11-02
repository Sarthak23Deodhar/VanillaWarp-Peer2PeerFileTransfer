// Controlled loopback comparisons. Requires a running server. Baselines restore
// one earlier scheduling behavior each; everything else uses the current client.
const fs=require('node:fs');
const base=process.env.VANILLAWARP_BROWSER_URL;
if(!base){console.error('Set VANILLAWARP_BROWSER_URL to a running VanillaWarp server.');process.exit(1);}
const engines=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.VANILLAWARP_BROWSER_ENGINE||'chromium';
const opts={headless:true};if(process.env.CHROME_PATH&&engine==='chromium'){opts.executablePath=process.env.CHROME_PATH;opts.args=['--no-sandbox','--no-zygote','--single-process'];}
const source=fs.readFileSync('resources/app.js','utf8');
const marker="previousSaved=reply(24*60*60*1000);s.dc.send('FILE_END');";
if(!source.includes(marker))throw new Error('Benchmark baseline marker changed; update the comparison.');
const baseline=source.replace(marker,"const baselineSaved=reply();s.dc.send('FILE_END');if(await baselineSaved!=='FILE_DONE')throw new Error('File was not saved.');");
const smallCount=30, delay=80;
const windowMarker='const window=adaptiveWindow(chunkSize);';
if(!source.includes(windowMarker))throw new Error('Benchmark window marker changed; update the comparison.');
const windowBaseline=source.replace(windowMarker,'const window={size:Math.max(1,Math.min(64,Math.floor(8*1024*1024/(chunkSize+28)))),observe(){}};');
const prepBaseline=source.replace('const PREFETCH_CHUNKS = 4;', 'const PREFETCH_CHUNKS = 1;');
if(prepBaseline===source)throw new Error('Benchmark prefetch marker changed; update the comparison.');
async function run(script,mode,ackDelay=delay){
 const browser=await engines[engine].launch(opts);const context=await browser.newContext();
 try {
  const sender=await context.newPage(),receiver=await context.newPage();
  for(const p of [sender,receiver])await p.route('**/app.js?*',route=>route.fulfill({status:200,contentType:'application/javascript',body:script}));
  await receiver.addInitScript(({ms,mode})=>{
   const files={};window.benchFiles=files;
   window.showDirectoryPicker=async()=>({async getFileHandle(name,opts={}){if(!(name in files)&&!opts.create)throw Object.assign(new Error('not found'),{name:'NotFoundError'});if(!(name in files))files[name]=0;return{async createWritable(){let bytes=0;return{async write(data){bytes+=data.byteLength;},async close(){files[name]=bytes;},async abort(){}};}};}});
   const send=RTCDataChannel.prototype.send;
   RTCDataChannel.prototype.send=function(data){if((mode==='small'&&(data==='READY'||data==='FILE_DONE'))||(mode==='large'&&data==='CHUNK_OK')){const channel=this;setTimeout(()=>{try{send.call(channel,data);}catch(_){}},ms);return;}return send.call(this,data);};
  },{ms:ackDelay,mode});
  await sender.goto(base);await receiver.goto(base);await sender.locator('#goSend').click();
  const files=mode==='small'?Array.from({length:smallCount},(_,i)=>({name:`file-${i}.txt`,buffer:Buffer.from('hello world')})):[{name:'large.bin',buffer:Buffer.alloc(24*1024*1024,42)}];await sender.locator('#fileInput').setInputFiles(files);
  await sender.locator('#startSend').click();await sender.locator('#codePanel').waitFor({state:'visible',timeout:20000});const code=await sender.locator('#roomCode').textContent();
  await receiver.locator('#goReceive').click();await receiver.locator('#codeInput').fill(code);await receiver.locator('#connectBtn').click();await receiver.locator('#chooseDestination').click();
  await Promise.all([sender.locator('#pairingPanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#pairingPanel').waitFor({state:'visible',timeout:30000})]);
  const t=performance.now();await sender.locator('#verifyButton').click();await receiver.locator('#verifyButton').click();
  await Promise.all([sender.locator('#donePanel').waitFor({state:'visible',timeout:30000}),receiver.locator('#donePanel').waitFor({state:'visible',timeout:30000})]);
  const ms=performance.now()-t;const saved=await receiver.evaluate(()=>Object.values(window.benchFiles));if(mode==='small'?(saved.length!==smallCount||saved.some(x=>x!==11)):(saved.length!==1||saved[0]!==24*1024*1024))throw new Error('Unexpected saved byte counts');
  return ms;
 } finally{await context.close();await browser.close();}
}
(async()=>{
 const old=await run(baseline,'small'), optimized=await run(source,'small');
 console.log(`Loopback, ${smallCount} tiny files, simulated ${delay} ms delay on READY/FILE_DONE acknowledgements:`);
 console.log(`Sequential: ${(old/1000).toFixed(2)} s; pipelined: ${(optimized/1000).toFixed(2)} s; ratio: ${(old/optimized).toFixed(2)}x`);
 const oldLarge=await run(windowBaseline,'large'), newLarge=await run(source,'large');
 console.log(`Loopback, one 24 MiB file, simulated ${delay} ms delay on CHUNK_OK acknowledgements:`);
 console.log(`Fixed 8 MiB window: ${(oldLarge/1000).toFixed(2)} s; adaptive: ${(newLarge/1000).toFixed(2)} s; ratio: ${(oldLarge/newLarge).toFixed(2)}x`);
 const oldPrep=await run(prepBaseline,'large',0), newPrep=await run(source,'large',0);
 console.log('Loopback, one 24 MiB file, no simulated acknowledgement delay:');
 console.log(`One prepared chunk: ${(oldPrep/1000).toFixed(2)} s; four prepared chunks: ${(newPrep/1000).toFixed(2)} s; ratio: ${(oldPrep/newPrep).toFixed(2)}x`);
 console.log('One sample per case; mocked disk. Not an internet or disk-speed benchmark.');
})().catch(e=>{console.error(e);process.exitCode=1;});
