const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
test('redesigned app exposes controls and removes obsolete QR/Turbo assets',()=>{
 const html=fs.readFileSync('resources/index.html','utf8');
 for(const id of ['fileInput','folderBtn','conflictPolicy','verificationWords','verifyButton','mismatchButton','progressBar'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/src="app\.js\?v=9"/);assert.match(html,/src="hash\.js\?v=1"/);assert.doesNotMatch(html,/qrcode|turbo/i);assert.ok(!fs.existsSync('resources/qrcode.js'));
});
test('Pages workflow validates and publishes only the public tunnel config',()=>{
 const yaml=fs.readFileSync('.github/workflows/pages.yml','utf8');assert.match(yaml,/workflow_dispatch/);assert.match(yaml,/lhr/);assert.match(yaml,/upload-pages-artifact/);assert.match(yaml,/resources\/hash\.js/);assert.doesNotMatch(yaml,/TURN_API_URL/);
});
test('adaptive transfer window grows and shrinks while respecting memory bounds',()=>{
 const vm=require('node:vm'), script=fs.readFileSync('resources/app.js','utf8');
 const source=script.slice(script.indexOf('  function adaptiveWindow('),script.indexOf('  async function waitForBuffer('));
 const create=vm.runInNewContext(source+'\nadaptiveWindow');
 for(const chunk of [16384,65508,250*1024]){
  const w=create(chunk),initial=w.size;assert.ok(w.max*(chunk+28)<=16*1024*1024);assert.ok(w.max<=256);
  for(let i=0;i<300;i++)w.observe(50,0);assert.ok(w.size>=initial);assert.equal(w.size,w.max);
  for(let i=0;i<200;i++)w.observe(3000,0);assert.ok(w.size<w.max);assert.ok(w.size>=Math.min(8,w.max));
 }
});
test('bundled incremental SHA-256 matches standard vectors over multiple blocks',()=>{
 const vm=require('node:vm'), crypto=require('node:crypto'), script=fs.readFileSync('resources/hash.js','utf8');
 const context={window:{},Uint8Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,globalThis:null};context.globalThis=context;vm.runInNewContext(script,context);
 for(const data of [Buffer.alloc(0),Buffer.from('abc'),Buffer.alloc(4*1024*1024+37,0xA5)]){
  const hash=context.window.VanillaWarpCreateSHA256();for(let i=0;i<data.length;i+=12345)hash.update(new Uint8Array(data.subarray(i,i+12345)));
  assert.equal(Buffer.from(hash.digest()).toString('hex'),crypto.createHash('sha256').update(data).digest('hex'));
 }
});
