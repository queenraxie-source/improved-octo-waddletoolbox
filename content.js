(function () {
  if (globalThis.__videoProFinderLoaded) return;
  globalThis.__videoProFinderLoaded = true;
  const videoPattern = /\.(mp4|webm|mov|m4v|m3u8|mpd)(?:[?#]|$)/i;
  const sources = new Map();
  const add = (src, metadata = {}) => {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
    let absolute; try { absolute = new URL(src, location.href).href; } catch { return; }
    if (!videoPattern.test(absolute) && !metadata.isVideo) return;
    const key = absolute.split('#')[0];
    const item = { src: absolute, label: metadata.label || document.title || 'Video source', resolution: metadata.resolution, bitrate: metadata.bitrate || 0, mime: metadata.mime || '', originHost: location.host, estimatedSize: metadata.estimatedSize || null, isDRM: Boolean(metadata.isDRM), title: document.title || 'Untitled video', poster: metadata.poster || '', codecs: metadata.codecs || '', subtitles: metadata.subtitles || [] };
    sources.set(key, { ...sources.get(key), ...item });
  };
  function scan() {
    sources.clear();
    document.querySelectorAll('video').forEach(video => {
    const subtitles = [...video.querySelectorAll('track[kind="subtitles"], track[kind="captions"]')].map(track => ({ src: track.src, label: track.label || track.srclang || 'Subtitles' }));
    add(video.currentSrc || video.src, { isVideo: true, poster: video.poster, subtitles, mime: video.getAttribute('type') || '' });
    video.querySelectorAll('source').forEach(source => add(source.src, { isVideo: true, mime: source.type || '', label: source.getAttribute('label') || '' }));
    });
    document.querySelectorAll('a[href], link[href]').forEach(node => add(node.href, { label: node.textContent.trim() || 'Linked video' }));
    // JSON/script data is treated as untrusted text; only URL-shaped strings are extracted.
    document.querySelectorAll('script:not([src])').forEach(script => {
      const matches = script.textContent.match(/(?:https?:)?\/\/[^\s"'\\]+\.(?:mp4|webm|m3u8|mpd)(?:\?[^\s"'\\]*)?/gi) || [];
      matches.forEach(url => add(url, { label: 'Embedded video' }));
    });
    chrome.runtime.sendMessage({ type: 'SOURCES_DETECTED', sources: [...sources.values()], title: document.title, pageUrl: location.href });
  }
  scan();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'RESCAN') { scan(); sendResponse({ ok: true }); return true; }
    if (message.type === 'CONTEXT_DOWNLOAD' && message.url) {
      const source = [...sources.values()].find(item => item.src === message.url) || { src: message.url, originHost: location.host, title: document.title };
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', source, filename: `${document.title || 'video'}.mp4`, title: document.title });
    }
    if (message.type === 'GET_SOURCES') sendResponse({ sources: [...sources.values()], title: document.title, pageUrl: location.href });
    return true;
  });
})();