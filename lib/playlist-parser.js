/* Pure playlist parsers. Network access stays in the popup so parsing is testable. */
export function resolveUrl(value, baseUrl) {
  try { return new URL(value, baseUrl).href; } catch { return value; }
}

function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,]*))/g)) result[match[1].toUpperCase()] = match[2] ?? match[3];
  return result;
}

export function parseHlsMaster(text, baseUrl = '') {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue;
    const info = attributes(lines[index].slice(lines[index].indexOf(':') + 1));
    const uri = lines.slice(index + 1).find(line => line && !line.startsWith('#'));
    if (!uri) continue;
    const [width, height] = (info.RESOLUTION || 'x').split('x').map(Number);
    variants.push({
      type: 'hls', src: resolveUrl(uri, baseUrl), playlistUrl: resolveUrl(uri, baseUrl),
      resolution: height ? { width, height } : undefined, bandwidth: Number(info.BANDWIDTH) || 0,
      bitrate: Number(info.BANDWIDTH) || 0, codecs: info.CODECS || '', label: height ? `${height}p` : 'Adaptive',
      mime: 'application/vnd.apple.mpegurl', segments: []
    });
  }
  return variants.sort((a, b) => (b.resolution?.height || 0) - (a.resolution?.height || 0) || b.bandwidth - a.bandwidth);
}

export function parseHlsMedia(text, baseUrl = '') {
  return text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => resolveUrl(line.trim(), baseUrl));
}

export function parseDashManifest(text, baseUrl = '') {
  const variants = [];
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  for (const representation of [...xml.querySelectorAll('Representation')]) {
    const set = representation.parentElement;
    const height = Number(representation.getAttribute('height') || set?.getAttribute('height')) || 0;
    const width = Number(representation.getAttribute('width') || set?.getAttribute('width')) || 0;
    const bandwidth = Number(representation.getAttribute('bandwidth')) || 0;
    const base = representation.querySelector('BaseURL')?.textContent || set?.querySelector('BaseURL')?.textContent || baseUrl;
    variants.push({ type: 'dash', src: resolveUrl(base, baseUrl), resolution: { width, height }, bandwidth, bitrate: bandwidth, codecs: representation.getAttribute('codecs') || set?.getAttribute('codecs') || '', label: height ? `${height}p` : 'Adaptive', mime: representation.getAttribute('mimeType') || set?.getAttribute('mimeType') || 'application/dash+xml' });
  }
  return variants.sort((a, b) => (b.resolution.height - a.resolution.height) || b.bandwidth - a.bandwidth);
}

export function parsePlaylist(text, url) {
  if (/#EXTM3U/i.test(text)) return parseHlsMaster(text, url);
  if (/<MPD[\s>]/i.test(text)) return parseDashManifest(text, url);
  return [];
}