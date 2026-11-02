// Disposable localhost editor fixture; all UI interactions use computer-use.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const output = path.resolve(__dirname, '../test-artifacts/input-0.7.3/browser-result.json');
const html = `<!doctype html><meta charset="utf-8"><title>声桥浏览器输入测试</title>
<style>body{max-width:800px;margin:50px auto;font:20px system-ui}textarea,[contenteditable],input{box-sizing:border-box;display:block;width:100%;min-height:90px;margin:16px 0;padding:16px;border:1px solid #999;font:20px system-ui}input{min-height:44px}pre{white-space:pre-wrap;font-size:16px}</style>
<h1>声桥浏览器输入测试</h1><p>仅在本机验证；不录音，不发送聊天消息。</p>
<label>普通网页输入框<textarea id="plain" aria-label="普通网页输入框"></textarea></label>
<label>聊天富文本输入框<div id="rich" contenteditable="true" role="textbox" aria-label="聊天富文本输入框"></div></label>
<label>密码框<input id="secret" type="password" aria-label="测试密码框"></label><pre id="status"></pre>
<script>const result={plain:'',rich:'',secureLength:0,events:{plain:0,rich:0},enters:0};
function report(){document.getElementById('status').textContent=JSON.stringify(result,null,2);fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)})}
for(const id of ['plain','rich'])document.getElementById(id).addEventListener('input',e=>{result[id]=id==='plain'?e.target.value:e.target.textContent;result.events[id]++;report()});
document.getElementById('secret').addEventListener('input',e=>{result.secureLength=e.target.value.length;report()});
addEventListener('keydown',e=>{if(e.key==='Enter'){result.enters++;report()}});report();</script>`;
http.createServer((req,res)=>{
  if(req.url==='/'&&req.method==='GET'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
  if(req.url==='/result'&&req.method==='POST'){
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy()});
    req.on('end',()=>{try{const value=JSON.parse(body);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(value,null,2));res.end('ok')}catch{res.writeHead(400);res.end()}});return;
  }res.writeHead(404);res.end();
}).listen(4319,'127.0.0.1',()=>console.log('Input fixture: http://127.0.0.1:4319'));
