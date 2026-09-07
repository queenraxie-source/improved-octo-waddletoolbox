import assert from 'node:assert/strict';
import { parseHlsMaster } from '../lib/playlist-parser.js';
import { calculateEta, formatEta } from '../lib/eta.js';
import { formatFilename, inferExtension } from '../lib/filename.js';
assert(inferExtension({ src: 'https://example.test/movie.webm' }) === 'webm', 'filename infers webm extension');

const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080\nhigh.m3u8';
const variants = parseHlsMaster(playlist, 'https://media.test/master.m3u8');
assert.equal(variants[0].label, '1080p');
assert.equal(variants[0].src, 'https://media.test/high.m3u8');
assert.equal(calculateEta(500, 1000, 1000), 1);
assert.equal(formatEta(65), '01:05');
assert.equal(formatFilename('{title}_{YYYYMMDD}_{quality}.mp4', { title: '../Lecture', quality: '1080p' }).startsWith('..'), false);
console.log('Video Pro Finder helper tests passed.');