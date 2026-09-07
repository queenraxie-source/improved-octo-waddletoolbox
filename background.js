import { sanitizeFilename } from './lib/filename.js';
import { isEncryptedHls, parseHlsMaster, resolveUrl } from './lib/playlist-parser.js';

const state = new Map();
const detectedIcon = { 16: 'icons/ultimate-krypton-icon.svg', 32: 'icons/ultimate-krypton-icon.svg', 48: 'icons/ultimate-krypton-icon.svg', 128: 'icons/ultimate-krypton-icon.svg' };
const defaultIcon = { 16: 'icons/ultimate-krypton-icon.svg', 32: 'icons/ultimate-krypton-icon.svg', 48: 'icons/ultimate-krypton-icon.svg', 128: 'icons/ultimate-krypton-icon.svg' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => chrome.contextMenus.create({ id: 'download-video', title: 'Download with Video Pro Finder', contexts: ['video', 'link'] }));
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !(info.srcUrl || info.linkUrl)) return;
  const message = { type: 'CONTEXT_DOWNLOAD', url: info.srcUrl || info.linkUrl };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SOURCES_DETECTED') {
    if (sender.tab?.id) chrome.action.setIcon({ tabId: sender.tab.id, path: message.sources?.length ? detectedIcon : defaultIcon });
    chrome.storage.session?.set({ [`tab_${sender.tab?.id}`]: message });
  }
  if (message.type === 'START_DOWNLOAD') startDownload(message, sender.tab).then(sendResponse);
  if (message.type === 'GET_DOWNLOAD_STATE') sendResponse(state.get(message.id) || null);
  return true;
});

async function startDownload(message, tab) {
  const source = message.source;
  if (!source?.src || source.src.startsWith('blob:')) return { ok: false, error: 'This player uses a blob URL. The original media request is protected or unavailable to the browser download API.' };
  if (source.isDRM) return { ok: false, error: 'This media appears to use DRM and cannot be downloaded by a standard browser extension.' };
  const filename = sanitizeFilename(message.filename || 'video.mp4');
  const id = crypto.randomUUID();
  state.set(id, { id, status: 'starting', received: 0, total: 0, filename, source, title: message.title, startedAt: Date.now() });
  try {
    if (source.type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(source.src)) return await downloadAccessibleHls(id, source, filename);
    const downloadId = await chrome.downloads.download({ url: source.src, filename, conflictAction: 'uniquify', saveAs: false });
    state.set(id, { ...state.get(id), downloadId, status: 'downloading' });
    return { ok: true, id, downloadId };
  } catch (error) {
    state.set(id, { ...state.get(id), status: 'error', error: friendlyError(error) });
    return { ok: false, id, error: friendlyError(error) };
  }
}
async function fallbackPlaylist(id, source, filename) {
  state.set(id, { ...state.get(id), status: 'playlist-fallback', error: 'This playlist needs a permitted segment merger.' });
  return { ok: false, id, playlist: source.src, error: 'The browser cannot safely merge this HLS stream here. Open the URL or use ffmpeg with: ffmpeg -i "PLAYLIST_URL" -c copy "FILENAME".' };
}
async function downloadAccessibleHls(id, source, filename) {
  try {
    const playlistResponse = await fetch(source.src, { credentials: 'include' });
    if (!playlistResponse.ok) throw new Error(`Playlist request returned ${playlistResponse.status}`);
    const playlistText = await playlistResponse.text();
    if (/#EXT-X-STREAM-INF:/i.test(playlistText)) {
      const variants = parseHlsMaster(playlistText, source.src);
      if (!variants.length) throw new Error('No HLS variants were found.');
      return { ok: false, id, playlist: variants[0].src, error: 'This is an HLS master playlist. Select a quality variant and try again.' };
    }
    if (isEncryptedHls(playlistText)) {
      return { ok: false, id, error: 'This HLS playlist is encrypted. The extension will not decrypt or bypass protected media.' };
    }
    const lines = playlistText.split(/\r?\n/).map(line => line.trim());
    const segmentUrls = lines.filter(line => line && !line.startsWith('#')).map(line => resolveUrl(line, source.src));
    if (!segmentUrls.length) throw new Error('The HLS media playlist has no segments.');
    if (segmentUrls.length > 2000) throw new Error('This playlist has too many segments for an in-browser merge. Use an authorized media tool instead.');
    const chunks = [];
    let received = 0;
    for (const segmentUrl of segmentUrls) {
      const response = await fetch(segmentUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`Segment request returned ${response.status}`);
      const chunk = await response.arrayBuffer();
      received += chunk.byteLength;
      if (received > 512 * 1024 * 1024) throw new Error('The playlist is larger than the browser merge limit.');
      chunks.push(chunk);
      state.set(id, { ...state.get(id), status: 'assembling', received, total: 0 });
    }
    const blob = new Blob(chunks, { type: 'video/mp2t' });
    const blobUrl = URL.createObjectURL(blob);
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: sanitizeFilename(filename.replace(/\.[^.]+$/, '.ts')), conflictAction: 'uniquify', saveAs: false });
    state.set(id, { ...state.get(id), downloadId, status: 'downloading', received, total: received });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    return { ok: true, id, downloadId };
  } catch (error) {
    const messageText = friendlyError(error);
    state.set(id, { ...state.get(id), status: 'playlist-fallback', error: messageText });
    return { ok: false, id, playlist: source.src, error: `${messageText} You can open the playlist or use an authorized HLS tool.` };
  }
}
function friendlyError(error) {
  const text = String(error?.message || error);
  return /cors|access|network|failed/i.test(text) ? 'The site blocked this request. Open the site in a new tab and allow cookies, or use a server proxy for authenticated downloads.' : text;
}
chrome.downloads.onChanged.addListener(delta => {
  for (const item of state.values()) if (item.downloadId === delta.id) {
    const next = { ...item };
    if (delta.state) next.status = delta.state.current;
    if (delta.bytesReceived) next.received = delta.bytesReceived.current;
    if (delta.totalBytes) next.total = delta.totalBytes.current;
    state.set(item.id, next);
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', ...next }).catch(() => {});
  }
});