import { isEncryptedHls, parseHlsMaster, resolveUrl } from './lib/playlist-parser.js';
import { outputFilename, transportStreamBlob } from './lib/muxer.js';
const stoppedJobs = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'MERGE_HLS') mergeHls(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error), playlist: message.source?.src }));
  if (message.type === 'MERGE_DASH') mergeDash(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error), playlist: message.source?.src }));
  if (message.type === 'STOP_LIVE') stoppedJobs.add(message.id);
  if (!['MERGE_HLS', 'MERGE_DASH'].includes(message.type)) return;
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
  const chunks = new Array(segmentUrls.length);
  let received = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < segmentUrls.length && !stoppedJobs.has(id)) {
      const index = cursor++;
      const response = await fetchWithRetry(segmentUrls[index]);
      if (!response.ok) throw new Error(`Segment request returned ${response.status}`);
      const chunk = await response.arrayBuffer();
      chunks[index] = chunk;
      received += chunk.byteLength;
      if (received > 512 * 1024 * 1024) throw new Error('This stream is larger than the browser merge limit.');
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_PROGRESS', id, received, total: segmentUrls.length }).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, segmentUrls.length) }, worker));
  const blobUrl = URL.createObjectURL(transportStreamBlob(chunks));
  try {
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: outputFilename(filename, 'ts'), conflictAction: 'uniquify', saveAs: false });
    return { ok: true, downloadId, received, total: received };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

async function mergeDash({ id, source, filename }) {
  const response = await fetchWithRetry(source.src);
  if (!response.ok) throw new Error(`MPD request returned ${response.status}`);
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (xml.querySelector('ContentProtection')) throw new Error('This DASH manifest is encrypted and cannot be merged.');
  const representations = [...xml.querySelectorAll('Representation')];
  const video = representations.filter(item => /video/i.test(item.getAttribute('mimeType') || item.parentElement?.getAttribute('mimeType') || ''))[0];
  const audio = representations.filter(item => /audio/i.test(item.getAttribute('mimeType') || item.parentElement?.getAttribute('mimeType') || ''))[0];
  if (!video) throw new Error('No simple DASH video representation was found.');
  const urls = representationUrls(video, source.src).concat(audio ? representationUrls(audio, source.src) : []);
  if (!urls.length || urls.length > 2000) throw new Error('This DASH manifest requires a full player for segment templates.');
  const chunks = [];
  let received = 0;
  for (const url of urls) { const item = await fetchWithRetry(url); if (!item.ok) throw new Error(`DASH segment request returned ${item.status}`); const chunk = await item.arrayBuffer(); received += chunk.byteLength; chunks.push(chunk); chrome.runtime.sendMessage({ type: 'OFFSCREEN_PROGRESS', id, received, total: urls.length }).catch(() => {}); }
  const blobUrl = URL.createObjectURL(transportStreamBlob(chunks));
  try { return { ok: true, downloadId: await chrome.downloads.download({ url: blobUrl, filename: outputFilename(filename, 'ts'), conflictAction: 'uniquify', saveAs: false }), received, total: received }; } finally { setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); }
}

function representationUrls(representation, manifestUrl) {
  const set = representation.parentElement;
  const base = representation.querySelector('BaseURL')?.textContent || set?.querySelector('BaseURL')?.textContent;
  const segmentList = representation.querySelector('SegmentList') || set?.querySelector('SegmentList');
  if (!base || !segmentList) return [];
  return [resolveUrl(base, manifestUrl), ...[...segmentList.querySelectorAll('SegmentURL')].map(item => resolveUrl(item.getAttribute('media'), resolveUrl(base, manifestUrl)))];
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
