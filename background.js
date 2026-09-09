import { sanitizeFilename } from './lib/filename.js';

const state = new Map();
const detectedIcon = { 16: 'icons/ultimate-krypton-icon.svg', 32: 'icons/ultimate-krypton-icon.svg', 48: 'icons/ultimate-krypton-icon.svg', 128: 'icons/ultimate-krypton-icon.svg' };
const defaultIcon = { 16: 'icons/ultimate-krypton-icon.svg', 32: 'icons/ultimate-krypton-icon.svg', 48: 'icons/ultimate-krypton-icon.svg', 128: 'icons/ultimate-krypton-icon.svg' };
const STATE_KEY = 'downloadState';
const networkSources = new Map();

restoreState();

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
    if (sender.tab?.id) {
      chrome.action.setIcon({ tabId: sender.tab.id, path: message.sources?.length ? detectedIcon : defaultIcon });
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(new Set((message.sources || []).map(source => source.src)).size) }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#d4af37' }).catch(() => {});
      chrome.runtime.sendMessage({ ...message, type: 'SOURCES_DETECTED', tabId: sender.tab.id }).catch(() => {});
    }
    chrome.storage.session?.set({ [`tab_${sender.tab?.id}`]: message });
  }
  if (message.type === 'START_DOWNLOAD') startDownload(message, sender.tab).then(sendResponse);
  if (message.type === 'GET_DOWNLOAD_STATE') sendResponse(state.get(message.id) || null);
  if (message.type === 'GET_DOWNLOAD_STATES') sendResponse([...state.values()]);
  if (message.type === 'GET_NETWORK_SOURCES') sendResponse(networkSources.get(message.tabId || sender.tab?.id) || []);
  if (message.type === 'OFFSCREEN_PROGRESS') {
    if (message.id && state.has(message.id)) setState(message.id, { ...state.get(message.id), status: 'assembling', received: message.received, total: message.total });
  }
  if (message.type === 'STOP_LIVE') chrome.runtime.sendMessage({ type: 'STOP_LIVE', id: message.id }).catch(() => {});
  return true;
});

async function startDownload(message, tab) {
  const source = message.source;
  if (!source?.src || source.src.startsWith('blob:')) return { ok: false, error: 'This player uses a blob URL. The original media request is protected or unavailable to the browser download API.' };
  if (source.isDRM) return { ok: false, error: 'This media appears to use DRM and cannot be downloaded by a standard browser extension.' };
  const limit = await checkDailyLimit();
  if (!limit.ok) return limit;
  const filename = sanitizeFilename(message.filename || 'video.mp4');
  const id = crypto.randomUUID();
  setState(id, { id, status: 'starting', received: 0, total: 0, filename, source, title: message.title, startedAt: Date.now(), retries: 0 });
  try {
    if (source.type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(source.src)) return await downloadAccessibleHls(id, source, filename);
    if (source.type === 'dash' || /\.mpd(?:[?#]|$)/i.test(source.src)) return await downloadAccessibleDash(id, source, filename);
    const downloadId = await chrome.downloads.download({ url: source.src, filename, conflictAction: 'uniquify', saveAs: false });
    setState(id, { ...state.get(id), downloadId, status: 'downloading' });
    return { ok: true, id, downloadId };
  } catch (error) {
    setState(id, { ...state.get(id), status: 'error', error: friendlyError(error) });
    return { ok: false, id, error: friendlyError(error) };
  }
}
async function downloadAccessibleDash(id, source, filename) {
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({ type: 'MERGE_DASH', id, source, filename: sanitizeFilename(filename) });
    if (!result?.ok) return { ok: false, id, playlist: result?.playlist || source.src, error: result?.error || 'This DASH manifest is too complex for browser assembly.' };
    setState(id, { ...state.get(id), downloadId: result.downloadId, status: 'downloading', received: result.received, total: result.total });
    return { ok: true, id, downloadId: result.downloadId };
  } catch (error) {
    const messageText = friendlyError(error);
    setState(id, { ...state.get(id), status: 'playlist-fallback', error: messageText });
    return { ok: false, id, playlist: source.src, error: `${messageText} Use an authorized DASH tool if the manifest requires a player.` };
  }
}
async function fallbackPlaylist(id, source, filename) {
  setState(id, { ...state.get(id), status: 'playlist-fallback', error: 'This playlist needs a permitted segment merger.' });
  return { ok: false, id, playlist: source.src, error: 'The browser cannot safely merge this HLS stream here. Open the URL or use ffmpeg with: ffmpeg -i "PLAYLIST_URL" -c copy "FILENAME".' };
}
async function downloadAccessibleHls(id, source, filename) {
  try {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({ type: 'MERGE_HLS', id, source, filename: sanitizeFilename(filename) });
    if (!result?.ok) {
      setState(id, { ...state.get(id), status: 'playlist-fallback', error: result?.error || 'The HLS stream could not be assembled.' });
      return { ok: false, id, playlist: result?.playlist || source.src, error: result?.error || 'The HLS stream could not be assembled.' };
    }
    setState(id, { ...state.get(id), downloadId: result.downloadId, status: 'downloading', received: result.received, total: result.total });
    return { ok: true, id, downloadId: result.downloadId };
  } catch (error) {
    const messageText = friendlyError(error);
    setState(id, { ...state.get(id), status: 'playlist-fallback', error: messageText });
    return { ok: false, id, playlist: source.src, error: `${messageText} You can open the playlist or use an authorized HLS tool.` };
  }
}
async function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyDownloads = { date: today, count: 0 } } = await chrome.storage.local.get('dailyDownloads');
  const current = dailyDownloads.date === today ? dailyDownloads : { date: today, count: 0 };
  return current.count >= 3 ? { ok: false, error: 'Daily download limit reached (3 completed downloads).' } : { ok: true };
}
async function countCompletedDownload() {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyDownloads = {} } = await chrome.storage.local.get('dailyDownloads');
  const count = dailyDownloads.date === today ? dailyDownloads.count : 0;
  return chrome.storage.local.set({ dailyDownloads: { date: today, count: count + 1 } });
}
async function ensureOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Assemble permitted unencrypted HLS segments for download.' });
  } catch (error) {
    if (!/already exists|Only (one|a single) offscreen document/i.test(String(error?.message || error))) throw error;
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
function setState(id, value) {
  state.set(id, value);
  chrome.storage.local.set({ [STATE_KEY]: Object.fromEntries(state) }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', ...value }).catch(() => {});
}
async function restoreState() {
  const stored = await chrome.storage.local.get(STATE_KEY).catch(() => ({}));
  for (const [id, item] of Object.entries(stored[STATE_KEY] || {})) state.set(id, { ...item, status: item.status === 'downloading' ? 'resuming' : item.status });
  const session = await chrome.storage.session?.get(null).catch(() => ({}));
  for (const [key, items] of Object.entries(session || {})) if (key.startsWith('network_')) networkSources.set(Number(key.slice(8)), items);
  for (const item of state.values()) {
    if (!item.downloadId) continue;
    chrome.downloads.search({ id: item.downloadId }).then(results => {
      const download = results[0];
      if (download) setState(item.id, { ...state.get(item.id), status: download.state === 'in_progress' ? 'downloading' : download.state, received: download.bytesReceived, total: download.totalBytes });
    }).catch(() => {});
  }
}
function friendlyError(error) {
  const text = String(error?.message || error);
  return /cors|access|network|failed/i.test(text) ? 'The site blocked this request. Open the site in a new tab and allow cookies, or use a server proxy for authenticated downloads.' : text;
}
chrome.downloads.onChanged.addListener(delta => {
  for (const item of state.values()) if (item.downloadId === delta.id) {
    const next = { ...item };
    if (delta.state) next.status = delta.state.current === 'in_progress' ? 'downloading' : delta.state.current;
    if (delta.bytesReceived) next.received = delta.bytesReceived.current;
    if (delta.totalBytes) next.total = delta.totalBytes.current;
    setState(item.id, next);
    if (delta.state?.current === 'complete') countCompletedDownload();
    if (delta.state?.current === 'interrupted' && (item.retries || 0) < 3) retryDownload(item);
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_PROGRESS', ...next }).catch(() => {});
  }
});

chrome.webRequest.onResponseStarted.addListener(details => {
  const headers = Object.fromEntries((details.responseHeaders || []).map(header => [header.name.toLowerCase(), header.value || '']));
  const mime = headers['content-type']?.split(';')[0].toLowerCase() || '';
  const isMedia = /^video\//.test(mime) || /mpegurl|dash\+xml/.test(mime) || /\.(mp4|webm|mov|m4v|mkv|m3u8|mpd|m4s|ts)(?:[?#]|$)/i.test(details.url);
  if (!isMedia || !details.tabId || details.tabId < 0) return;
  const source = { src: details.url, label: 'Network media', mime, originHost: new URL(details.url).host, estimatedSize: Number(headers['content-length']) || null, isDRM: /drm|encrypted|widevine|playready|fairplay/i.test(details.url), downloadable: true };
  chrome.storage.local.get('mediaFilters').then(({ mediaFilters = {} }) => {
    const minSize = Number(mediaFilters.minSize || 300 * 1024);
    const formats = mediaFilters.formats || ['HLS', 'DASH', 'MP4', 'WebM', 'audio'];
    const blocklist = mediaFilters.blocklist || [];
    const format = /mpegurl/.test(mime) ? 'HLS' : /dash/.test(mime) ? 'DASH' : /^audio\//.test(mime) ? 'audio' : /webm/.test(mime) ? 'WebM' : 'MP4';
    if (source.estimatedSize && source.estimatedSize < minSize) return;
    if (blocklist.some(host => source.originHost === host || source.originHost.endsWith(`.${host}`))) return;
    if (!formats.some(item => item.toLowerCase() === format.toLowerCase())) return;
    addNetworkSource(details.tabId, source);
  });
}, { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other'] }, ['responseHeaders', 'extraHeaders']);
function addNetworkSource(tabId, source) {
  const items = networkSources.get(tabId) || [];
  if (!items.some(item => item.src === source.src)) items.push(source);
  networkSources.set(tabId, items.slice(-100));
  chrome.storage.session?.set({ [`network_${tabId}`]: networkSources.get(tabId) });
  chrome.action.setIcon({ tabId, path: detectedIcon }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: String(networkSources.get(tabId).length) }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#d4af37' }).catch(() => {});
}
async function retryDownload(item) {
  const retryCount = (item.retries || 0) + 1;
  setState(item.id, { ...item, status: 'retrying', retries: retryCount, error: `Network interruption. Retrying (${retryCount}/3)…` });
  await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
  try {
    const downloadId = await chrome.downloads.download({ url: item.source.src, filename: item.filename, conflictAction: 'uniquify', saveAs: false });
    setState(item.id, { ...state.get(item.id), downloadId, status: 'downloading' });
  } catch (error) {
    setState(item.id, { ...state.get(item.id), status: retryCount < 3 ? 'interrupted' : 'error', error: friendlyError(error) });
  }
}