const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const base = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07';
const ASSETS = {
  sensevoice: [
    { file: 'sensevoice/model.int8.onnx', url: base + '/model.int8.onnx', size: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
    { file: 'sensevoice/tokens.txt', url: base + '/tokens.txt', size: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  ],
  'qwen3-asr': [
  {
    "file": "qwen3-asr/conv_frontend.onnx",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/model_1.7B/conv_frontend.onnx",
    "size": 48080441,
    "sha256": "fa894a4ba53da6a4238f2a6ca0b09362e505d39cecbd646051b033e2e8d7e2fb"
  },
  {
    "file": "qwen3-asr/decoder.int8.onnx",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/model_1.7B/decoder.int8.onnx",
    "size": 2037458645,
    "sha256": "c43c853fa6e97d08365cb8a5502b360b595cd43c00dc60e4d8ca7cc18cad460b"
  },
  {
    "file": "qwen3-asr/encoder.int8.onnx",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/model_1.7B/encoder.int8.onnx",
    "size": 314222162,
    "sha256": "436fbd910a0c8914851e5ac1354e807be9f283d08a5da728adaa609731c41469"
  },
  {
    "file": "qwen3-asr/tokenizer/merges.txt",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/tokenizer/merges.txt",
    "size": 1671853,
    "sha256": "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5"
  },
  {
    "file": "qwen3-asr/tokenizer/tokenizer_config.json",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/tokenizer/tokenizer_config.json",
    "size": 12487,
    "sha256": "4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c"
  },
  {
    "file": "qwen3-asr/tokenizer/vocab.json",
    "url": "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/9c182309f7bb075f241424441add9e16c5086dfb/tokenizer/vocab.json",
    "size": 2776833,
    "sha256": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"
  }
],
  'whisper-turbo': [
  {
    "file": "whisper-turbo/turbo-decoder.int8.onnx",
    "url": "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/2ca6ff69fc878651b770880507669577ac41c2ff/turbo-decoder.int8.onnx",
    "size": 361080764,
    "sha256": "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547"
  },
  {
    "file": "whisper-turbo/turbo-encoder.int8.onnx",
    "url": "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/2ca6ff69fc878651b770880507669577ac41c2ff/turbo-encoder.int8.onnx",
    "size": 674716297,
    "sha256": "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b"
  },
  {
    "file": "whisper-turbo/turbo-tokens.txt",
    "url": "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/2ca6ff69fc878651b770880507669577ac41c2ff/turbo-tokens.txt",
    "size": 816730,
    "sha256": "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126"
  }
],
  vad: [{ file: 'vad/silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', size: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' }],
};
function assetsFor(model) {
  if (model === 'ensemble') return [...ASSETS.sensevoice, ...ASSETS['qwen3-asr'], ...ASSETS['whisper-turbo'], ...ASSETS.vad];
  if (!['sensevoice', 'whisper-base', 'qwen3-asr', 'whisper-turbo'].includes(model)) throw new Error('无效的本地语音模型。');
  return [...(ASSETS[model] || []), ...ASSETS.vad];
}
function assetsInstalled(directory, model) {
  return assetsFor(model).every(asset => { try { return fs.statSync(path.join(directory, asset.file)).size === asset.size; } catch { return false; } });
}
async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function prepareAssets(directory, model, allowDownload, onProgress = () => {}) {
  for (const asset of assetsFor(model)) {
    const file = path.join(directory, asset.file);
    if (fs.existsSync(file) && fs.statSync(file).size === asset.size && await digest(file) === asset.sha256) continue;
    if (!allowDownload) throw new Error('本地语音模型缺失或校验失败，请在设置中下载 / 修复模型。');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + crypto.randomUUID() + '.download';
    try {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw new Error(`模型下载失败 (${response.status})，请检查网络后重试。`);
      const hash = crypto.createHash('sha256'); let received = 0, last = -1;
      const check = new Transform({ transform(chunk, _, callback) {
        received += chunk.length; hash.update(chunk);
        if (received > asset.size) return callback(new Error('模型文件大小不符，已停止下载。'));
        const progress = Math.floor(received * 100 / asset.size);
        if (progress !== last) { last = progress; onProgress({ status: 'progress', file: asset.file, progress }); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), check, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('模型校验失败，请重试；未使用下载文件。');
      await fs.promises.rename(temporary, file);
    } finally { await fs.promises.rm(temporary, { force: true }); }
  }
}
module.exports = { ASSETS, assetsInstalled, prepareAssets, digest };
