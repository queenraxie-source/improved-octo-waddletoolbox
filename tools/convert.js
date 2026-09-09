const $ = selector => document.querySelector(selector);
let file = null;
let output = 'mp4';

$('#file-input').onchange = event => setFile(event.target.files[0]);
$('#dropzone').ondragover = event => { event.preventDefault(); $('#dropzone').classList.add('drag'); };
$('#dropzone').ondragleave = () => $('#dropzone').classList.remove('drag');
$('#dropzone').ondrop = event => { event.preventDefault(); $('#dropzone').classList.remove('drag'); setFile(event.dataTransfer.files[0]); };
document.querySelectorAll('.output').forEach(button => button.onclick = () => { output = button.dataset.format; document.querySelectorAll('.output').forEach(item => item.classList.toggle('active', item === button)); updateMode(); });
$('#history-file').onclick = async () => { const { history = [] } = await chrome.storage.local.get('history'); const item = history[0]; if (!item?.source?.src) return setStatus('No successful download is recorded yet.'); try { const response = await fetch(item.source.src, { credentials: 'include' }); if (!response.ok) throw new Error(`Request returned ${response.status}`); setFile(new File([await response.blob()], item.filename || 'video.mp4', { type: response.headers.get('content-type') || 'video/mp4' })); } catch (error) { setStatus(`Could not read the last source locally: ${error.message}`); } };
$('#convert').onclick = convert;

function setFile(next) { if (!next) return; file = next; $('#file-name').textContent = `${file.name} · ${formatBytes(file.size)}`; $('#convert').disabled = false; updateMode(); setStatus('Ready for local conversion.'); }
function updateMode() { $('#mode').textContent = output === 'mp4' ? 'Path A: remux, no re-encode. Path B: re-encode if required.' : 'Path A: remux, no re-encode. Path B: re-encode if required.'; }
async function convert() {
  if (!file) return;
  $('#convert').disabled = true; $('#progress').hidden = false; $('#progress').value = 5; setStatus('Loading local conversion engine…');
  try {
    const engine = await import('../vendor/ffmpeg.wasm/ffmpeg.js');
    const result = await engine.convert({ file, output, mode: 'auto', onProgress: value => { $('#progress').value = value; } });
    const blob = result.blob || result;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = replaceExtension(file.name, output); link.click();
    setStatus(result.reencoded ? 'Converted locally · re-encode' : 'Converted locally · remux, no re-encode');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    setStatus('Local FFmpeg engine is not installed in vendor/ffmpeg.wasm yet. Add the vendored engine to enable MP4 remux and re-encode.');
  } finally { $('#convert').disabled = false; }
}
function replaceExtension(name, extension) { return `${name.replace(/\.[^.]+$/, '')}.${extension}`; }
function formatBytes(value) { if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function setStatus(message) { $('#status').textContent = message; }
