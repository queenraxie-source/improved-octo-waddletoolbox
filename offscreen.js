import { isEncryptedHls, parseHlsMaster, resolveUrl } from './lib/playlist-parser.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'MERGE_HLS') return;
  mergeHls(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error), playlist: message.source?.src }));
  return true;
});

async function mergeHls({ id, source, filename }) {
  const playlistResponse = await fetchWithRetry(source.src);
  if (!playlistResponse.ok) throw new Error(`Playlist request returned ${playlistResponse.status}`);
  const playlistText = await playlistResponse.text();
  if (/#EXT-X-STREAM-INF:/i.test(playlistText)) {
    const variants = parseHlsMaster(playlistText, source.src);
    return { ok: false, playlist: variants[0]?.src || source.src, error: 'Select a quality variant before downloading the HLS stream.' };
  }
  if (isEncryptedHls(playlistText)) throw new Error('This HLS playlist is encrypted and cannot be merged by the extension.');
  const segmentUrls = playlistText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => resolveUrl(line, source.src));
  if (!segmentUrls.length) throw new Error('The HLS media playlist has no segments.');
  if (segmentUrls.length > 2000) throw new Error('This playlist is too large for an in-browser merge.');
  const chunks = [];
  let received = 0;
  for (const url of segmentUrls) {
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`Segment request returned ${response.status}`);
    const chunk = await response.arrayBuffer();
    received += chunk.byteLength;
    if (received > 512 * 1024 * 1024) throw new Error('This stream is larger than the browser merge limit.');
    chunks.push(chunk);
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_PROGRESS', id, received, total: 0 }).catch(() => {});
  }
  const blobUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/mp2t' }));
  try {
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: filename.replace(/\.[^.]+$/, '.ts'), conflictAction: 'uniquify', saveAs: false });
    return { ok: true, downloadId, received, total: received };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok || (response.status >= 400 && response.status < 500)) return response;
      throw new Error(`Network request returned ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}
