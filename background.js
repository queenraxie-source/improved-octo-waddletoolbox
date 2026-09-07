import { sanitizeFilename } from './lib/filename.js';

const state = new Map();
const detectedIcon = { 16: 'icons/icon-detected.svg', 32: 'icons/icon-detected.svg', 48: 'icons/icon-detected.svg', 128: 'icons/icon-detected.svg' };
const defaultIcon = { 16: 'icons/icon.svg', 32: 'icons/icon.svg', 48: 'icons/icon.svg', 128: 'icons/icon.svg' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'download-video', title: 'Download with Video Pro Finder', contexts: ['video', 'link'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id && (info.srcUrl || info.linkUrl)) chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_DOWNLOAD', url: info.srcUrl || info.linkUrl });
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
  const filename = sanitizeFilename(message.filename || 'video.mp4');
  const id = crypto.randomUUID();
  state.set(id, { id, status: 'starting', received: 0, total: 0, filename, source, title: message.title, startedAt: Date.now() });
  try {
    if (source.type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(source.src)) return await fallbackPlaylist(id, source, filename);
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