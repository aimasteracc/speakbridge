const { parentPort, workerData } = require('./inference-port.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { formatChineseNumbers } = require('./speech-text.cjs');
const { consensus } = require('./transcript-consensus.cjs');
(async () => {
  let recognize;
  async function createNative(model) {
    const { OfflineRecognizer } = require('sherpa-onnx-node');
    const file = name => path.join(workerData.cacheDir, model, name);
    const models = model === 'qwen3-asr' ? { qwen3Asr: {
      convFrontend: file('conv_frontend.onnx'), encoder: file('encoder.int8.onnx'), decoder: file('decoder.int8.onnx'),
      tokenizer: file('tokenizer'), maxTotalLen: 1024, maxNewTokens: 384, temperature: 0.000001,
    } } : model === 'whisper-turbo' ? { whisper: {
      encoder: file('turbo-encoder.int8.onnx'), decoder: file('turbo-decoder.int8.onnx'),
      language: workerData.language === 'auto' ? '' : workerData.language, task: 'transcribe',
    }, tokens: file('turbo-tokens.txt') } : {
      senseVoice: { model: path.join(workerData.cacheDir, 'sensevoice/model.int8.onnx'), language: workerData.language === 'auto' ? '' : workerData.language, useInverseTextNormalization: 1 },
      tokens: path.join(workerData.cacheDir, 'sensevoice/tokens.txt'),
    };
    const recognizer = await OfflineRecognizer.createAsync({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: {
      ...models, numThreads: 4, provider: 'cpu', debug: 0,
    }, decodingMethod: 'greedy_search' });
    return async (audio, language, dictionary = []) => {
      const stream = recognizer.createStream();
      if (model === 'qwen3-asr') {
        const languages = { zh: 'Chinese', ja: 'Japanese', en: 'English', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German' };
        if (language !== 'auto') stream.setOption('language', languages[language]);
        stream.setOption('hotwords', dictionary.join(','));
      }
      stream.acceptWaveform({ sampleRate: 16000, samples: audio });
      const result = await recognizer.decodeAsync(stream);
      const text = result.text.replace(/<\|[^|]*\|>/g, '').trim();
      return model === 'qwen3-asr' ? formatChineseNumbers(text, language) : text;
    };
  }
  if (workerData.model === 'ensemble') {
    const fast = await createNative('sensevoice');
    const qwen = await createNative('qwen3-asr');
    const whisper = await createNative('whisper-turbo');
    recognize = async (audio, language, dictionary, preview) => {
      const first = await fast(audio, language);
      if (preview || !first) return first;
      const second = await qwen(audio, language, dictionary);
      const third = await whisper(audio, language);
      return consensus(first, second, third);
    };
  } else if (workerData.model !== 'whisper-base') {
    recognize = await createNative(workerData.model);
  } else {
    const { createRecognizer } = await import(pathToFileURL(path.join(__dirname, 'asr-runtime.mjs')).href);
    recognize = await createRecognizer(workerData.cacheDir, workerData.allowDownload, progress => parentPort.postMessage({ type: 'progress', progress }));
  }
  parentPort.postMessage({ type: 'ready' });
  let queue = Promise.resolve();
  parentPort.on('message', request => {
    queue = queue.then(async () => {
      try { const text = await recognize(new Float32Array(request.audio), request.language, request.dictionary, request.preview); parentPort.postMessage({ type: 'result', id: request.id, text }); }
      catch (error) { parentPort.postMessage({ type: 'result', id: request.id, error: error.message }); }
    });
  });
})().catch(error => { parentPort.postMessage({ type: 'fatal', error: error.message }); });
