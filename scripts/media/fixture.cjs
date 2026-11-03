// Tutorial-only in-memory adapter. It never accesses real credentials, sessions,
// native input, OS permissions, or model services. Real React UI is unchanged.
const { DEFAULT_SETTINGS } = require('../../electron/core.cjs');
const { notesPlan } = require('../../electron/meeting-notes.cjs');
const version = require('../../package.json').version;
const sampleNotes = `# 产品入门教程讨论

## 1. 会议概要

| 项目 | 内容 |
| --- | --- |
| 日时 | 不明 |
| 目的 | 确认教程内容，让新用户完成首次使用。 |

## 2. 议程

- 配置语音与文字引擎
- 展示会议记录和跨应用听写

## 3. 讨论内容

### 3.1 教程范围

- 先演示本地语音识别与 DeepSeek 文字处理的配置。
- 需要展示自动填入输入框，并说明不会自动发送。

## 4. 决定事项

| # | 决定事项 | 补充 |
| --- | --- | --- |
| 1 | 使用虚构的会议资料制作教程 | 不使用真实会议或密钥 |

## 5. 行动项

| # | 内容 | 负责人 | 期限 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 编写首次使用步骤 | 未定 | 未定 | 未着手 |
| 2 | 检查图片和视频中的文字 | 未定 | 未定 | 未着手 |

## 6. 后续待讨论事项

- 确认不同平台的权限操作。

## 7. 会议总结

本次确认了教程范围，下一步是整理示例并检查内容。

**备注**：本纪要为教程固定样例，依据虚构转写展示排版，不代表实际 API 生成。`;
function setup(fast = false) {
  const session = { id: 'tutorial-meeting', title: '产品入门教程讨论 · 示例', startedAt: new Date('2026-11-03T10:00:00+09:00').getTime(), endedAt: new Date('2026-11-03T10:02:00+09:00').getTime(), durationMs: 120000, audioSource: 'microphone', sourceLanguage: 'zh', targetLanguage: 'en', status: 'completed', demo: false, notes: '', segments: [
    { id:'a', text:'今天确认首次使用教程，先配置本地识别和 DeepSeek。', translation:'Today we will outline the quick-start tutorial.', startMs:0,endMs:8000,final:true },
    { id:'b', text:'再展示会议纪要和语音输入，使用虚构资料，不使用真实会议。', translation:'Show meeting notes and dictation with fictional examples.', startMs:8000,endMs:16000,final:true },
    { id:'c', text:'文字填入后先检查，由使用者自己发送。负责人和期限还没有确定。', translation:'Review the inserted text before sending it yourself.', startMs:16000,endMs:24000,final:true },
  ] };
  const settings = {...DEFAULT_SETTINGS, speechProvider:'local', textProvider:'api', baseUrl:'https://api.deepseek.com', translationModel:'deepseek-flash', hasKey:false, hasSonioxKey:false, canEncrypt:true};
  return {fast, sampleNotes, plan: notesPlan(session,settings,'api','auto'),
    boot:{settings,sessions:[session,{...session,id:'tutorial-weekly',title:'项目周会 · 示例',notes:sampleNotes}],state:{status:'idle',session:null,error:''},platform:'darwin',appVersion:version, dataDirectory:'教程专用内存示例 · 不访问真实数据',shortcutAvailable:true,
      capabilities:{localInstalled:true,localReady:true,localModels:{sensevoice:true},codex:'',claude:'',deepseek:''},
      dictation:{preferences:{holdKey:'off',handsFreeShortcut:'CommandOrControl+Shift+D',cleanupProvider:'off'},holdAvailable:false,handsFreeAvailable:true,inputAvailable:true,microphonePermission:'granted',modelInstalled:true,modelReady:true,message:''}}
  };
}
function install({boot,fast,sampleNotes,plan}) {
  const listeners=new Set(), copy=v=>structuredClone(v), delay=ms=>new Promise(r=>setTimeout(r,fast?Math.min(60,ms):ms));
  localStorage.setItem('speakbridge.appearance.v1','sage');
  window.__tutorialBoot=boot;
  window.__emit=(type,payload)=>{if(type==='session')boot.state=copy(payload);if(type==='dictation-feedback')boot.dictationFeedback=copy(payload);for(const listener of listeners)listener({type,payload:copy(payload)});};
  const history=()=>window.__emit('history',boot.sessions);
  window.speakbridge={
    bootstrap:async()=>copy(boot),onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    detectEngines:async()=>copy(boot.capabilities),dictationStatus:async()=>copy(boot.dictation),prepareDictation:async()=>copy(boot.dictation),requestInputPermission:async()=>copy(boot.dictation),
    checkEngines:async()=>({speech:'local',text:'api'}),audio:()=>{},dictationLevel:()=>{},
    saveSettings:async input=>{const {apiKey,sonioxApiKey,...preferences}=input;boot.settings={...boot.settings,...preferences,...(apiKey?{hasKey:true}:{})};return copy(boot.settings);},
    prepareModel:async()=>{await delay(800);return copy(boot.capabilities);},
    testConnection:async()=>{throw Error('教程模式不访问 API。实际使用请在桌面应用测试连接。');},
    start:async()=>{const s={...copy(boot.sessions[0]),id:'tutorial-live',startedAt:Date.now(),endedAt:undefined,durationMs:0,segments:[],notes:'',engines:{speech:'local',text:'api'},speechModel:'sensevoice'};window.__emit('session',{status:'recording',session:s,error:''});},
    stop:async()=>{const s={...boot.state.session,endedAt:Date.now(),durationMs:24000,status:'completed'};window.__emit('session',{status:'idle',session:s,error:''});},
    showOverlay:async visible=>window.__emit('overlay',visible),listSessions:async()=>copy(boot.sessions),
    notesStatus:async id=>({id,state:'idle',message:''}),notesPlan:async(id,lang)=>({...plan,language:lang==='auto'?'zh':lang}),
    makeNotes:async(id,lang)=>{window.__emit('notes-progress',{id,state:'running',message:'正在生成纪要…',startedAt:Date.now()});await delay(2400);const s=boot.sessions.find(s=>s.id===id);s.notes=sampleNotes;s.notesLanguage=lang==='auto'?'zh':lang;history();window.__emit('notes-progress',{id,state:'completed',message:'纪要已生成并保存。'});return copy(s);},
    cancelNotes:async()=>{},updateSession:async(id,patch)=>{const s=boot.sessions.find(s=>s.id===id);Object.assign(s,patch);history();return copy(s);},
    deleteNotesMany:async ids=>{boot.sessions.forEach(s=>{if(ids.includes(s.id))s.notes='';});history();return copy(boot.sessions);},
    deleteSessions:async ids=>{boot.sessions=boot.sessions.filter(s=>!ids.includes(s.id));history();return copy(boot.sessions);},
    deleteNotes:async id=>{const s=boot.sessions.find(s=>s.id===id);s.notes='';history();return copy(s);},
    deleteSession:async id=>{boot.sessions=boot.sessions.filter(s=>s.id!==id);history();return copy(boot.sessions);},
    saveDictationPreferences:async preferences=>{boot.dictation.preferences=preferences;window.__emit('dictation-readiness',boot.dictation);return copy(boot.dictation);},
    copySession:async()=>true,exportSession:async()=>true,copyDictation:async()=>true,cancelDictation:async()=>{},finishDictation:async()=>{},hideDictation:async()=>{},
  };
}
module.exports={setup,install};
