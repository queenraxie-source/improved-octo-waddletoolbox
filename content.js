(function () {
  if (globalThis.__videoProFinderLoaded) return;
  globalThis.__videoProFinderLoaded = true;
  const mediaPattern = /\.(mp4|webm|mov|m4v|mkv|m3u8|mpd|m4s|ts)(?:[?#]|$)/i;
  const playlistPattern = /\.(m3u8|mpd)(?:[?#]|$)/i;
  const sources = new Map();
  let scanTimer;
  const add = (value, metadata = {}) => {
    if (!value || typeof value !== 'string' || value.startsWith('data:')) return;
    let src;
    try { src = new URL(value, location.href).href; } catch { return; }
    const isBlob = src.startsWith('blob:');
    const isMedia = Boolean(metadata.isVideo || metadata.isMedia || mediaPattern.test(src));
    if (!isMedia) return;
    const key = src.split('#')[0];
    const previous = sources.get(key) || {};
    sources.set(key, {
      src, label: metadata.label || previous.label || (isBlob ? 'Protected or blob-backed video' : document.title || 'Video source'),
      resolution: metadata.resolution || previous.resolution, bitrate: metadata.bitrate || previous.bitrate || 0,
      mime: metadata.mime || previous.mime || '', originHost: location.host, estimatedSize: metadata.estimatedSize || previous.estimatedSize || null,
      isDRM: Boolean(metadata.isDRM || previous.isDRM || /encrypted|drm|widevine|playready|fairplay/i.test(src)),
      title: document.title || 'Untitled video', poster: metadata.poster || previous.poster || '', codecs: metadata.codecs || previous.codecs || '',
      subtitles: metadata.subtitles || previous.subtitles || [], downloadable: !isBlob && !playlistPattern.test(src)
    });
  };
  function scanVideoElements() {
    document.querySelectorAll('video, audio').forEach(media => {
      const subtitles = [...media.querySelectorAll('track')].map(track => ({ src: track.src, label: track.label || track.srclang || 'Subtitles' })).filter(track => track.src);
      add(media.currentSrc || media.src, { isVideo: true, poster: media.poster, subtitles, mime: media.getAttribute('type') || media.type || '' });
      media.querySelectorAll('source').forEach(source => add(source.src, { isVideo: true, mime: source.type || '', label: source.getAttribute('label') || '' }));
    });
  }
  function scanDocumentUrls() {
    document.querySelectorAll('a[href], link[href], [data-src], [data-video], [data-url], [data-hls], [data-mpd]').forEach(node => {
      for (const attribute of ['href', 'src', 'data-src', 'data-video', 'data-url', 'data-hls', 'data-mpd']) {
        const value = node.getAttribute(attribute);
        if (value) add(value, { label: node.textContent.trim() || 'Linked video' });
      }
    });
    document.querySelectorAll('script:not([src]), script[type="application/json"], iframe').forEach(node => {
      const text = node.textContent || node.getAttribute('src') || '';
      const matches = text.match(/(?:https?:)?\/\/[^\s"'\\<>]+|(?:\/|\.\/|\.\.\/)[^\s"'\\<>]+/gi) || [];
      matches.map(value => value.replace(/\\["']/g, '').replace(/[),;]+$/, '')).forEach(value => add(value, { label: 'Embedded media URL' }));
    });
    performance.getEntriesByType('resource').forEach(entry => add(entry.name, { isMedia: mediaPattern.test(entry.name), label: 'Page media request' }));
  }
  function scan() {
    sources.clear();
    scanVideoElements();
    scanDocumentUrls();
    const result = { sources: [...sources.values()], title: document.title, pageUrl: location.href };
    chrome.runtime.sendMessage({ type: 'SOURCES_DETECTED', ...result });
    return result;
  }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 250); }
  scan();
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data-src', 'data-video'] });
  new PerformanceObserver(scheduleScan).observe({ type: 'resource', buffered: true });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'RESCAN') { sendResponse(scan()); return true; }
    if (message.type === 'CONTEXT_DOWNLOAD' && message.url) {
      const source = [...sources.values()].find(item => item.src === message.url) || { src: message.url, originHost: location.host, title: document.title };
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', source, filename: `${document.title || 'video'}.mp4`, title: document.title });
    }
    if (message.type === 'GET_SOURCES') sendResponse({ sources: [...sources.values()], title: document.title, pageUrl: location.href });
    return true;
  });
})();