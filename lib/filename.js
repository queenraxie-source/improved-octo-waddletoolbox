export const DEFAULT_PROMPT = 'Save highest-quality non-DRM stream as MP4; prefer 1080p>720p>480p; include subtitles if available; filename "{title}_{YYYYMMDD}_{quality}.mp4"; auto-save to Downloads; show gold progress bar and ETA.';

export function sanitizeFilename(value, fallback = 'video') {
  return String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 180) || fallback;
}

export function formatFilename(template, data = {}) {
  const date = new Date();
  const values = { YYYYMMDD: date.toISOString().slice(0, 10).replaceAll('-', ''), ext: 'mp4', ...data };
  const name = String(template || DEFAULT_PROMPT).replace(/^.*?filename\s+["']?([^"';]+\.(?:mp4|webm|mkv|ts))["']?.*$/i, '$1').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  return sanitizeFilename(name.includes('.') ? name : `${name}.mp4`);
}