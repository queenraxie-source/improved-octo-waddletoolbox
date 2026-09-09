import { FFmpeg } from './classes.js';

const coreURL = new URL('./ffmpeg-core.js', import.meta.url).href;
const wasmURL = new URL('./ffmpeg-core.wasm', import.meta.url).href;
const workerURL = new URL('./worker.js', import.meta.url).href;

export async function convert({ file, output, onProgress = () => {} }) {
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(100, Math.round(progress * 100)))));
  await ffmpeg.load({ coreURL, wasmURL, classWorkerURL: workerURL });
  const input = `input${extension(file.name)}`;
  const target = `output.${output}`;
  await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
  const remuxArgs = ['-i', input, '-map', '0', '-c', 'copy', target];
  let code = await ffmpeg.exec(remuxArgs);
  let reencoded = false;
  if (code !== 0) {
    reencoded = true;
    code = await ffmpeg.exec(['-i', input, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', output === 'webm' ? 'libvpx-vp9' : 'libx264', '-c:a', output === 'webm' ? 'libopus' : 'aac', '-movflags', '+faststart', target]);
  }
  if (code !== 0) throw new Error('FFmpeg could not convert this file.');
  const data = await ffmpeg.readFile(target);
  ffmpeg.terminate();
  return { blob: new Blob([data], { type: `video/${output === 'mp4' ? 'mp4' : output}` }), reencoded };
}

function extension(name) { const match = String(name || '').match(/\.[^.]+$/); return match ? match[0].toLowerCase() : '.bin'; }
