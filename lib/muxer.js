/* Keeps muxing behind one small boundary. A future vendored MP4 muxer can replace this implementation. */
export function transportStreamBlob(chunks) {
  return new Blob(chunks, { type: 'video/mp2t' });
}

export function outputFilename(filename, fallbackExtension = 'ts') {
  const base = String(filename || 'video').replace(/\.[^.]+$/, '');
  return `${base}.${fallbackExtension}`;
}