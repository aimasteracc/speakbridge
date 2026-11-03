// Package already-rendered media into a dependency-free local viewing page.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const dir=path.resolve(__dirname,'../../docs/media');
const file=name=>path.join(dir,name);
const manifest=JSON.parse(fs.readFileSync(file('video-manifest.json'),'utf8'));
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate','-of','json',file('speakbridge-quickstart-zh.mp4')],{encoding:'utf8'}));
manifest.chapters=manifest.chapters.map(c=>({...c,start:Number(c.start.toFixed(3))}));
manifest.encoded={durationSeconds:Number(probe.format.duration),bytes:Number(probe.format.size),streams:probe.streams};
manifest.provenance={image:'Built-in imagegen; prompt: scripts/media/image-prompt.txt',video:'Project React UI + in-memory synthetic adapter + HTML stage + Chromium + ffmpeg',artwork:'Project build/icon.svg and existing Lucide UI icons; no third-party footage, music, voice or font files'};
fs.writeFileSync(file('video-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
execFileSync('ffmpeg',['-y','-loglevel','error','-i',file('speakbridge-quickstart-zh.mp4'),'-frames:v','1','-update','1',file('speakbridge-video-cover.png')]);
const time=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const chapters=manifest.chapters.map(c=>`<button data-time="${c.start.toFixed(3)}"><span>${time(c.start)}</span>${c.title}</button>`).join('\n');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>声桥 · 中文上手视频</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f0f5f1;color:#243a30;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1180px;margin:48px auto;padding:0 24px 48px}header{display:flex;align-items:center;gap:15px}header img{width:52px}h1{font-size:32px;margin:0}p{line-height:1.8;color:#52675c}.meta{font-size:15px}video{display:block;width:100%;aspect-ratio:16/9;background:#243a30;border-radius:16px;box-shadow:0 14px 45px #26472a26}.chapters{display:flex;flex-wrap:wrap;gap:9px;margin:24px 0}.chapters button{font:inherit;font-size:15px;text-align:left;padding:12px 16px;border-radius:12px;border:1px solid #ccdbd0;background:#fff;color:#2c4838;cursor:pointer}.chapters span{color:#718879;margin-right:10px;font-variant-numeric:tabular-nums}.chapters button:hover{background:#e1ecdf}.chapters button:focus-visible,a:focus-visible{outline:3px solid #53936b;outline-offset:3px}.links{display:flex;gap:20px;flex-wrap:wrap}a{color:#25643e;text-underline-offset:4px}.note{background:#e1ecdf;padding:18px 24px;border-radius:12px}.overview{width:100%;max-width:900px;margin-top:18px;border-radius:12px}details{margin-top:26px}summary{cursor:pointer;font-weight:600}footer{margin-top:34px;border-top:1px solid #cfded3;padding-top:18px;font-size:14px;color:#607368}@media(max-width:600px){main{margin-top:24px;padding:0 14px 30px}h1{font-size:24px}header img{width:40px}.chapters button{flex:1 0 44%;padding:10px;font-size:14px}}</style>
<main><header><img src="../../build/icon.svg" alt=""><h1>声桥 · 中文上手视频</h1></header><p class="meta">v${manifest.version} · ${time(manifest.encoded.durationSeconds)} · 1080p / 24 fps · 中文字幕已嵌入画面 · 无配音</p>
<video id="tutorial" controls playsinline preload="metadata" poster="speakbridge-video-cover.png" aria-label="声桥中文上手视频"><source src="speakbridge-quickstart-zh.mp4" type="video/mp4">请下载 MP4 后播放。</video>
<nav class="chapters" aria-label="视频章节">${chapters}</nav>
<div class="links"><a href="speakbridge-quickstart-zh.mp4" download>下载 MP4</a><a href="speakbridge-overview.png" download>下载流程图</a><a href="speakbridge-quickstart-zh.srt" download>SRT 字幕</a><a href="speakbridge-quickstart-zh.vtt" download>VTT 字幕</a><a href="../guides/video-tour.md">文字说明</a></div>
<p class="note">操作使用当前界面与虚构资料。语音识别、模型响应、权限状态和目标输入结果为模拟，不代表真实 API 或原生输入验收。云端服务可能收费并接收相应资料。</p>
<details><summary>展开完整功能与使用流程图</summary><img class="overview" src="speakbridge-overview.png" alt="配置引擎、开始记录、生成纪要，以及跨应用听写的快捷键流程"></details>
<footer>声桥 SpeakBridge · 本页和视频可随仓库离线使用，无远程字体、统计或播放器依赖。</footer></main>
<script>const video=document.getElementById('tutorial');document.querySelectorAll('[data-time]').forEach(button=>button.addEventListener('click',()=>{video.currentTime=Number(button.dataset.time);video.play().catch(()=>{});}));</script></html>`;
fs.writeFileSync(file('watch.html'),html);
const names=['speakbridge-overview.png','speakbridge-video-cover.png','speakbridge-quickstart-zh.mp4','speakbridge-quickstart-zh.srt','speakbridge-quickstart-zh.vtt','watch.html','video-manifest.json'];
fs.writeFileSync(file('SHA256SUMS.txt'),names.map(name=>crypto.createHash('sha256').update(fs.readFileSync(file(name))).digest('hex')+'  '+name).join('\n')+'\n');
console.log(JSON.stringify({durationSeconds:manifest.encoded.durationSeconds,bytes:manifest.encoded.bytes,files:names.length,chapters:manifest.chapters.map(c=>({time:time(c.start),title:c.title}))}));
