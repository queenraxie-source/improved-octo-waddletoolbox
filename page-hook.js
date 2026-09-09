(function () {
  if (window.__videoProFinderHook) return;
  window.__videoProFinderHook = true;
  const media = /\.(m3u8|mpd|mp4|m4s|ts|webm)(?:[?#]|$)/i;
  const hint = /(video\/|audio\/|mpegurl|dash\+xml)/i;
  const report = (url, mime = '') => { if (typeof url === 'string' && (media.test(url) || hint.test(mime))) window.postMessage({ source: 'video-pro-finder', type: 'MEDIA', url, mime }, '*'); };
  const originalFetch = window.fetch;
  window.fetch = function (...args) { return originalFetch.apply(this, args).then(response => { report(response.url, response.headers.get('content-type') || ''); return response; }); };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__vpfUrl = url; return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) { this.addEventListener('readystatechange', () => { if (this.readyState === 2) report(this.responseURL || this.__vpfUrl, this.getResponseHeader('content-type') || ''); }); return send.apply(this, args); };
})();