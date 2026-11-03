// Produce an annotated tutorial from the real React UI, using the isolated
// synthetic adapter only. Requires existing dev dependencies and local ffmpeg.
const { chromium } = require('playwright');
const { setup, install } = require('./fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'../..');
const fast = process.argv.includes('--fast');
const artifacts = path.join(root,'test-artifacts/onboarding-media',fast?'preview':'final');
const media = path.join(root,'docs/media');
const version = require('../../package.json').version;
const data = setup(fast), cues=[], chapters=[], errors=[], blocked=[];
let browser,context,server,page,app,hud,video,first=0,epoch=0,index=0;
fs.mkdirSync(artifacts,{recursive:true});
const sleep = s => new Promise(resolve=>setTimeout(resolve,fast?Math.max(50,s*35):s*1000));
const stamp = seconds => {const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
const elapsed = ()=> (Date.now()-epoch)/1000;
async function scene(chapter,title,detail,note,caption){
 const start=elapsed();if(cues.length)cues.at(-1).end=start;cues.push({start,text:caption});
 if(chapters.at(-1)?.title!==chapter)chapters.push({start,title:chapter});
 await page.evaluate(value=>window.setScene(value),{chapter,number:`STEP ${String(chapters.length-1).padStart(2,'0')}`,title,detail,note,caption,progress:Math.min(97,++index*3.6)});
}
async function point(locator){await locator.scrollIntoViewIfNeeded();await sleep(.3);const box=await locator.boundingBox();assert.ok(box);await page.evaluate(box=>window.point({x:box.x+box.width/2,y:box.y+box.height/2,width:box.width,height:box.height}),box);await sleep(.5);}
async function click(locator){await point(locator);await page.evaluate(()=>document.querySelector('#cursor').classList.add('click'));await locator.click();await sleep(.35);await page.evaluate(()=>{document.querySelector('#cursor').classList.remove('click');document.querySelector('#cursor').style.opacity='0';document.querySelector('#highlight').style.display='none';});}
async function select(locator,value){await point(locator);await locator.selectOption(value);await sleep(.6);}
async function fill(locator,value){await click(locator);await locator.fill('');await locator.pressSequentially(value,{delay:fast?0:35});await sleep(.4);}
async function shot(name){await page.screenshot({path:path.join(artifacts,name+'.png')});}
async function nav(name){await click(app.getByRole('button',{name,exact:true}));}
(async()=>{
 const { createServer }=await import('vite');
 server=await createServer({root,clearScreen:false,server:{host:'127.0.0.1',port:0},plugins:[{name:'tutorial-stage',configureServer(server){server.middlewares.use('/__media',(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'stage.html')));});}}]});
 await server.listen();const url=server.resolvedUrls.local[0],origin=new URL(url).origin;
 browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Tokyo',permissions:['microphone'],recordVideo:{dir:artifacts,size:{width:1920,height:1080}}});
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();blocked.push(new URL(u).origin);return route.abort();});
 await context.addInitScript(install,data);
 page=await context.newPage();video=page.video();epoch=Date.now();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'__media');app=page.frameLocator('#app');hud=page.frameLocator('#hud');
 await app.getByRole('heading',{name:'实时翻译',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);first=elapsed();
 cues.push({start:first,text:'声桥快速上手：配置、会议纪要、语音输入和历史管理。'});chapters.push({start:first,title:'开场'});
 await shot('00-intro');await sleep(5);
 await scene('配置 DeepSeek','分开选择两个引擎','声音先变成文字，再由文字模型翻译或整理纪要。','本例：本地 SenseVoice\n+ DeepSeek 文字 API','打开设置：语音转写选本地，翻译与纪要选云端 API。');
 await nav('设置');await select(app.getByLabel('语音转写引擎'),'local');await select(app.getByLabel('翻译与纪要引擎'),'api');await shot('01-engines');await sleep(3);
 await scene('配置 DeepSeek','先准备语音模型','在本地识别模型中选择 SenseVoice，首次使用点击下载。','示例模型已准备\n实际下载需网络和磁盘空间','首次使用先下载语音模型；下载完成后，音频可在本机识别。');
 await point(app.getByRole('button',{name:'检查 / 修复模型',exact:true}));await sleep(3);
 await scene('配置 DeepSeek','保存自己的密钥','在 OpenAI 兼容服务区域填入 DeepSeek 的地址、模型和密钥。','API 地址不加 /responses\n示例中不调用真实 API','地址填写 https://api.deepseek.com；模型填写账户支持的名称。');
 await fill(app.getByLabel('API 地址',{exact:true}),'https://api.deepseek.com');await fill(app.getByLabel('翻译 / 纪要模型',{exact:true}),'deepseek-flash');await shot('02-api-fields');await sleep(3);
 await scene('配置 DeepSeek','密钥只填进应用','粘贴后保存，确认显示“已加密保存”。实际使用再测试连接。','屏幕中是无效占位文字\n真实连接测试可能消耗额度','平台发出密钥后，还要保存到声桥；不要把真实密钥发进聊天或文档。');
 await fill(app.getByLabel(/^API Key/),'TUTORIAL_PLACEHOLDER');await click(app.getByRole('button',{name:'保存设置',exact:true}));await app.getByText('已加密保存',{exact:true}).waitFor();await shot('03-saved');await sleep(3);
 await scene('记录会议','选择音源和语言','麦克风用于现场说话；系统音频用于电脑声音，也可以混合采集。','真实使用需授予录音权限\n本片音频与结果为模拟','回到实时翻译，选择音频来源、源语言和翻译目标。');
 await nav('实时翻译');await select(app.getByLabel('音频来源',{exact:true}),'microphone');await select(app.getByLabel('源语言',{exact:true}),'zh');await select(app.getByLabel('翻译目标',{exact:true}),'en');await sleep(2);
 await scene('记录会议','开始，等待定稿','识别中的文字会继续修订；结束后等待保存，再生成纪要。','预览可以变化\n当前速度不代表实测延迟','点击开始会话。转写会持续更新，定稿后再交给后续处理。');
 await click(app.getByRole('button',{name:/^开始会话/}));await app.getByRole('heading',{name:'正在聆听',exact:true}).waitFor();
 for(let i=0;i<3;i++){
  await app.locator('body').evaluate((_,i)=>{const s=structuredClone(window.__tutorialBoot.state.session);s.segments=structuredClone(window.__tutorialBoot.sessions[0].segments.slice(0,i+1));s.segments.at(-1).final=false;window.__emit('session',{status:'recording',session:s,error:''});},i);await sleep(1.5);
  await app.locator('body').evaluate(()=>{const s=structuredClone(window.__tutorialBoot.state.session);s.segments.at(-1).final=true;window.__emit('session',{status:'recording',session:s,error:''});});
 }
 await shot('04-transcript');await sleep(2);await click(app.getByRole('button',{name:/^结束会话/}));
 await scene('生成会议纪要','选择记录与语言','打开已结束的会话，选择自动语言，或手动指定中文、日文、英文。','中文原文 → 中文纪要\n混合语言可手动选择','到会议纪要中打开记录，选择输出语言，再点击生成会议纪要。');
 await nav('会议纪要');await click(app.locator('[data-session-id="tutorial-meeting"] .history-open'));await app.locator('.notes-controls select').waitFor();await select(app.locator('.notes-controls select'),'ja');await sleep(1);await select(app.locator('.notes-controls select'),'zh');await sleep(2);
 await scene('生成会议纪要','生成后核对内容','按模型容量处理长资料。完整成功后保存；失败时保留旧纪要。','此处使用固定纪要样例\n并非真实 DeepSeek 调用','等待生成完成后核对 Markdown 纪要；负责人、期限等不能凭空补充。');
 await click(app.getByRole('button',{name:'生成会议纪要',exact:true}));await app.locator('.markdown-notes h1').waitFor();await app.locator('.markdown-notes h1').scrollIntoViewIfNeeded();await shot('05-notes');await sleep(3);
 await point(app.locator('.markdown-notes h2').filter({hasText:'5. 行动项'}));await shot('06-actions');await sleep(3);await click(app.getByRole('button',{name:'关闭详情',exact:true}));
 await scene('跨应用听写','先完成准备','到语音输入页检查麦克风、模型和输入权限。Mac 还需辅助功能授权。','没有右 Option？\n可使用免持听写快捷键','语音输入与会议录音不同：先准备权限，再回到目标应用的输入框。');
 await nav('语音输入');await shot('07-dictation');await sleep(4);
 await scene('跨应用听写','默认原文直出','原文直出不调用文字模型。可选整理会增加等待；联网引擎还会发送文字。','当前选择：原文直出\n不会自动发送消息','听写输出默认原文直出；选择联网整理时，注意文字发送范围和费用。');
 await point(app.getByLabel('听写输出',{exact:true}));await sleep(4);
 await scene('跨应用听写','点击目标输入框','使用免持快捷键：Mac 是 ⌘ + Shift + D，Windows 是 Ctrl + Shift + D。','以下为输入流程示意\n不是目标应用兼容性实测','先点击目标输入框，再按一次快捷键开始说话。');
 await page.evaluate(()=>{document.querySelector('#editor').style.display='block';document.querySelector('#highlight').style.display='none';});
 await click(page.locator('#target'));await page.evaluate(()=>document.querySelector('.keys').style.display='flex');await sleep(2);
 await page.evaluate(()=>{document.querySelector('.keys').style.display='none';document.querySelector('.hud').style.display='block';});
 const dictation={id:'tutorial-dictation',mode:'dictation',startedAt:Date.now(),durationMs:0,segments:[],dictation:{status:'pending',text:'',message:''}};
 await hud.locator('body').evaluate((_,s)=>{window.__emit('session',{status:'recording',session:s,error:''});window.__emit('dictation-feedback',{phase:'listening',targetName:'示例编辑器',mode:'handsfree'});window.__emit('dictation-level',.35);},dictation);
 for(const text of ['我们下周','我们下周三下午','我们下周三下午三点讨论教程。']){await hud.locator('body').evaluate((_,text)=>{const s=structuredClone(window.__tutorialBoot.state.session);s.segments=[{text,final:false}];window.__emit('session',{status:'recording',session:s,error:''});window.__emit('dictation-level',.3);},text);await sleep(1.2);}
 await scene('跨应用听写','再按一次，等待填入','定稿完成后才写入目标。初稿留在悬浮条中，不逐字改动输入框。','文字已填入 ≠ 已发送\n发送前请检查内容','再按一次结束，等待文字填入；声桥不会替你按回车发送。');
 await page.evaluate(()=>document.querySelector('.keys').style.display='flex');await sleep(1.4);await page.evaluate(()=>document.querySelector('.keys').style.display='none');
 await hud.locator('body').evaluate(()=>window.__emit('dictation-feedback',{phase:'finishing',message:'正在完成识别…'}));await sleep(1.5);
 const finalText='我们下周三下午三点讨论教程。';
 await page.locator('#target').fill(finalText);assert.equal(await page.locator('#target').inputValue(),finalText);
 await hud.locator('body').evaluate((_,text)=>{const s=structuredClone(window.__tutorialBoot.state.session);s.dictation={text,rawText:text,status:'inserted',message:'文字已填入，请检查。'};window.__emit('session',{status:'idle',session:s,error:''});window.__emit('dictation-feedback',{phase:'done'});},finalText);
 await page.evaluate(()=>document.querySelector('.unsubmitted').style.display='block');await shot('08-insert');await sleep(4);
 await scene('管理历史','按范围删除','会话历史删除整条会话；会议纪要页只删除纪要，保留转写与翻译。','全选仅作用于当前筛选结果\n删除前会确认范围','需要批量清理时勾选或全选；注意“删除会话”和“只删除纪要”的区别。');
 await page.evaluate(()=>{document.querySelector('#editor').style.display='none';document.querySelector('.hud').style.display='none';});
 await nav('会议纪要');await click(app.getByRole('checkbox',{name:'全选',exact:true}));await app.getByText('已选 2 条',{exact:true}).waitFor();await shot('09-select-all');await sleep(3);
 await click(app.getByRole('button',{name:'删除所选 2 份纪要',exact:true}));await shot('10-delete-confirm');await sleep(3);await click(app.getByRole('button',{name:'取消',exact:true}));
 await scene('配色与完成','换成喜欢的配色','外观与配色提供五套主题，也可以跟随系统。选择后自动保存。','完整文字指南在项目文档中\n本地语音与云端文字独立配置','外观与配色可以随时切换。现在，你可以从自己的第一次会话开始。');
 await nav('外观与配色');await click(app.getByRole('radio',{name:/海蓝/}));await shot('11-appearance');await sleep(4);
 await scene('配色与完成','从一条短记录开始','先确认权限、模型与连接，再处理正式资料。生成与输入的文字都需要检查。','本地识别无 API 按次费用\n云端服务可能收费并接收资料','更多步骤见项目文档；真实资料是否可发送云端，应按所选服务与公司要求确认。');
 await page.evaluate(()=>document.querySelector('#progress').style.width='100%');await sleep(5);await shot('12-end');cues.at(-1).end=elapsed();
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await context.close();context=null;await browser.close();browser=null;
 const raw=await video.path();const duration=cues.at(-1).end-first;
 const out=fast?path.join(artifacts,'preview.mp4'):path.join(media,'speakbridge-quickstart-zh.mp4');
 execFileSync('ffmpeg',['-y','-loglevel','error','-ss',first.toFixed(3),'-i',raw,'-t',duration.toFixed(3),'-an','-vf','fps=24,format=yuv420p','-c:v','libx264','-preset',fast?'ultrafast':'medium','-crf',fast?'27':'22','-movflags','+faststart',out],{stdio:'inherit'});
 const normalized=cues.map(c=>({start:Number(Math.max(0,c.start-first).toFixed(3)),end:Number((c.end-first).toFixed(3)),text:c.text}));
 const timeline=chapters.map(c=>({start:Number(Math.max(0,c.start-first).toFixed(3)),title:c.title}));
 const report={version,width:1920,height:1080,fps:24,durationSeconds:Number(duration.toFixed(3)),audio:'none',burnedInChineseCaptions:true,syntheticData:true,simulatedModelAndInputResults:true,realUserDataAccessed:false,externalRequests:blocked.length,pageErrors:errors,chapters:timeline};
 fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify(report,null,2)+'\n');
 if(!fast){
  fs.writeFileSync(path.join(media,'speakbridge-quickstart-zh.vtt'),'WEBVTT\n\n'+normalized.map(c=>`${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
  fs.writeFileSync(path.join(media,'speakbridge-quickstart-zh.srt'),normalized.map((c,i)=>`${i+1}\n${stamp(c.start).replace('.',',')} --> ${stamp(c.end).replace('.',',')}\n${c.text}\n`).join('\n'));
  fs.writeFileSync(path.join(media,'video-manifest.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify({output:path.relative(root,out),...report}));
})().catch(async error=>{console.error(error.stack);if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{await context?.close();await browser?.close();await server?.close();});
