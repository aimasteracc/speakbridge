// Fixed public corpus; references are used only by the scorer, never by ASR.
// The legacy partition names split the original eight clips from later clips.
// Entries 1–32 were used for model selection; only 33–48 are independent validation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const runtime = process.env.ASR_RUNTIME_ROOT || path.resolve(__dirname, '../electron');
const { WhisperManager, LocalTranscriber } = require(path.join(runtime, 'local-speech.cjs'));
const { DEFAULT_SETTINGS } = require(path.join(runtime, 'core.cjs'));
const { createHash } = require('node:crypto');
const root = process.env.ASR_CORPUS_DIR ? path.resolve(process.env.ASR_CORPUS_DIR) : path.resolve(__dirname, '../test-artifacts/asr-evaluation');
const minRank = Number(process.env.ASR_MIN_RANK || 1);
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'corpus.json')));
const model = process.argv[2] || 'sensevoice';
const variant = process.argv[3] || 'clean';
const complete = process.argv[4] === 'complete';
const outputName = `${process.env.ASR_OUTPUT_TAG || ''}${model}-${variant}${complete ? '-complete' : ''}`;
assert.ok(['clean', 'noise10'].includes(variant));
const normal = text => Array.from(text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
function score(reference, text) {
  const a = normal(reference), b = normal(text); let prev = Array.from({ length:b.length+1 }, (_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}
  return { errors:prev[b.length], characters:a.length };
}
function addNoise(pcm) {
  const samples=pcm.length/2;let power=0,seed=41;const noise=new Float64Array(samples);let noisePower=0;
  for(let i=0;i<samples;i++){power+=pcm.readInt16LE(i*2)**2;seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=seed/2**32-.5;noisePower+=noise[i]**2;}
  const gain=Math.sqrt(power/(10*noisePower));const out=Buffer.alloc(pcm.length);
  for(let i=0;i<samples;i++)out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(pcm.readInt16LE(i*2)+noise[i]*gain))),i*2);
  return out;
}
(async()=>{
  const manager=new WhisperManager(path.resolve(__dirname,'../test-artifacts/models')),results=[],counts={zh:0,ja:0};
  try{
    for(const item of corpus.rows){
      const rank=++counts[item.language], file=path.join(root,item.file);
      if(rank<minRank)continue;
      assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),item.sha256);
      let pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-f','s16le','-ac','1','-ar','24000','pipe:1']);
      if(variant==='noise10')pcm=addNoise(pcm);
      const rows=new Map(),errors=[];
      const engine=new LocalTranscriber({manager,settings:{...DEFAULT_SETTINGS,localModel:model,sourceLanguage:item.language,targetLanguage:'off',dictionary:[]},translateText:async()=>'',onSegment:row=>rows.set(row.id,row),onFatal:e=>errors.push(e),onWarning:e=>errors.push(e)});
      if(complete)engine.gate.completeSentences=true;
      await engine.connect();const start=performance.now();
      for(let i=0;i<pcm.length;i+=4800)engine.push(pcm.subarray(i,i+4800));
      await engine.stop();assert.deepEqual(errors,[]);assert.ok([...rows.values()].every(r=>r.final&&!r.error));
      const text=[...rows.values()].map(r=>r.text).join(' '),elapsedMs=performance.now()-start;
      const result={...item,rank,partition:rank<=8?'development':'holdout',variant,text,...score(item.reference,text),durationSec:pcm.length/48000,elapsedMs};results.push(result);
      fs.writeFileSync(path.join(root,`${outputName}.json`),JSON.stringify({model,variant,completeSentences:engine.gate.completeSentences,dataset:corpus.dataset,revision:corpus.revision,results},null,2));
      console.log(model,variant,item.language,rank,result.errors+'/'+result.characters,Math.round(elapsedMs)+'ms');
    }
    const summary={};
    for(const language of ['zh','ja'])for(const partition of ['development','holdout','all']){
      const rows=results.filter(r=>r.language===language&&(partition==='all'||r.partition===partition));
      const errors=rows.reduce((n,r)=>n+r.errors,0),characters=rows.reduce((n,r)=>n+r.characters,0),durationSec=rows.reduce((n,r)=>n+r.durationSec,0);
      summary[language+'-'+partition]={clips:rows.length,errors,characters,cer:errors/characters,durationSec,rtf:rows.reduce((n,r)=>n+r.elapsedMs,0)/1000/durationSec};
    }
    fs.writeFileSync(path.join(root,`${outputName}-summary.json`),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
  }finally{manager.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
