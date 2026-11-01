const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
test('redesigned app exposes controls and removes obsolete QR/Turbo assets',()=>{
 const html=fs.readFileSync('resources/index.html','utf8');
 for(const id of ['fileInput','folderBtn','conflictPolicy','verificationWords','verifyButton','mismatchButton','progressBar'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/src="app\.js"/);assert.doesNotMatch(html,/qrcode|turbo/i);assert.ok(!fs.existsSync('resources/qrcode.js'));
});
test('Pages workflow validates and publishes only the public tunnel config',()=>{
 const yaml=fs.readFileSync('.github/workflows/pages.yml','utf8');assert.match(yaml,/workflow_dispatch/);assert.match(yaml,/lhr/);assert.match(yaml,/upload-pages-artifact/);assert.doesNotMatch(yaml,/TURN_API_URL/);
});
