const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');
const cp=process.env.VANILLAWARP_TEST_CLASSPATH;
test('server room tokens, one joiner, CORS, ICE, and cancellation', {skip:!cp,timeout:20000}, async t=>{
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const proc=spawn(process.env.JAVA||'java',['-cp',cp,'WebRelayServer'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),VANILLAWARP_TUNNEL:'0',VANILLAWARP_TURN_API_URL:'',VANILLAWARP_PAGES_ORIGIN:'https://owner.github.io'},stdio:'ignore'});t.after(()=>proc.kill());
  const base=`http://127.0.0.1:${port}`;let initial;
  for(let i=0;i<100;i++){try{initial=await fetch(base+'/');break;}catch(_){await new Promise(r=>setTimeout(r,50));}}
  assert.ok(initial);assert.match(await initial.text(),/VanillaWarp/);assert.match(initial.headers.get('content-security-policy'),/default-src 'self'/);
  const hash=await fetch(base+'/hash.js');assert.equal(hash.status,200);assert.match(hash.headers.get('content-type'),/javascript/);assert.match(await hash.text(),/Paul Miller/);
  assert.equal((await fetch(base+'/qrcode.js')).status,404);assert.equal((await fetch(base+'/api/status/extra')).status,404);
  const apiStatus=await fetch(base+'/api/status');assert.equal(apiStatus.headers.get('x-content-type-options'),'nosniff');assert.equal(apiStatus.headers.get('cache-control'),'no-store');
  const options=origin=>fetch(base+'/api/offer',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET'}});
  assert.equal((await options('https://evil.example')).status,403);
  const pre=await options('https://owner.github.io');assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://owner.github.io');
  const post=(path,headers={},body='{}')=>fetch(base+path,{method:'POST',headers,body});
  const room=await (await post('/api/room/create')).json();assert.match(room.code,/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$/);assert.match(room.ownerToken,/^[\w-]{32}$/);
  const query='?code='+room.code, owner={'X-Owner-Token':room.ownerToken};
  assert.equal((await post('/api/room/join'+query)).status,404);
  assert.equal((await post('/api/offer'+query)).status,403);
  assert.equal((await post('/api/offer'+query,{},'x'.repeat(262145))).status,403,'authentication occurs before reading oversized bodies');
  assert.equal((await post('/api/offer'+query,owner,'x'.repeat(262145))).status,413);
  assert.equal((await post('/api/offer'+query,owner,'{"version":3}')).status,200);
  assert.equal((await post('/api/offer'+query,owner)).status,409);
  assert.deepEqual(await (await fetch(base+'/api/offer'+query)).json(),{version:3});
  const joined=await (await post('/api/room/join'+query)).json();assert.match(joined.joinToken,/^[\w-]{32}$/);
  assert.equal((await post('/api/room/join'+query)).status,409);
  assert.equal((await fetch(base+'/api/answer'+query)).status,403);
  assert.equal((await fetch(base+'/api/answer'+query,{headers:owner})).status,404);
  assert.equal((await post('/api/answer'+query,{'X-Join-Token':'wrong'})).status,403);
  assert.equal((await post('/api/answer'+query,{'X-Join-Token':joined.joinToken},'{"answer":1}')).status,200);
  assert.deepEqual(await (await fetch(base+'/api/answer'+query,{headers:owner})).json(),{answer:1});
  assert.equal((await fetch(base+'/api/ice'+query)).status,403);
  const ice=await (await fetch(base+'/api/ice'+query,{headers:owner})).json();assert.equal(ice.relay,false);assert.ok(ice.iceServers.length);
  assert.equal((await post('/api/room/cancel'+query,{'X-Join-Token':joined.joinToken})).status,200);
  assert.equal((await fetch(base+'/api/answer'+query,{headers:owner})).status,410);
  for(let i=0;i<9;i++)assert.equal((await post('/api/room/create')).status,200);
  assert.equal((await post('/api/room/create')).status,429);
});
test('global room cap stays bounded across many source addresses and frees capacity on cancellation', {skip:!cp || process.platform!=='linux',timeout:30000}, async t=>{
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const proc=spawn(process.env.JAVA||'java',['-cp',cp,'WebRelayServer'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),VANILLAWARP_TUNNEL:'0',VANILLAWARP_TURN_API_URL:''},stdio:'ignore'});t.after(()=>proc.kill());
  const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){try{await fetch(base+'/api/status');break;}catch(_){await new Promise(r=>setTimeout(r,50));}}
  // Linux loopback provides distinct local IPs; each remains under the per-IP room rate.
  async function postFrom(ip,path,headers={}){return new Promise((resolve,reject)=>{const sock=net.connect({host:'127.0.0.1',port,localAddress:ip});let data='';sock.setEncoding('utf8');sock.on('connect',()=>sock.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n${Object.entries(headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')}\r\n`));sock.on('data',x=>data+=x);sock.on('end',()=>{const head=data.slice(0,data.indexOf('\r\n\r\n'));const status=Number(head.split(' ')[1]);let body=data.slice(data.indexOf('\r\n\r\n')+4);if(/transfer-encoding: chunked/i.test(head))body=body.replace(/^[0-9a-f]+\r\n/i,'').replace(/\r\n0\r\n\r\n$/,'');resolve({status,body});});sock.on('error',reject);});}
  let first;
  for(let i=0;i<128;i++){const result=await postFrom(`127.0.0.${2+Math.floor(i/10)}`,'/api/room/create');assert.equal(result.status,200);if(i===0)first=JSON.parse(result.body);}
  assert.equal((await postFrom('127.0.0.16','/api/room/create')).status,503);
  assert.equal((await postFrom('127.0.0.16',`/api/room/cancel?code=${first.code}`,{'X-Owner-Token':first.ownerToken})).status,200);
  assert.equal((await postFrom('127.0.0.16','/api/room/create')).status,200);
});
