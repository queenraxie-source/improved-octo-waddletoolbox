# Video Pro Finder

Video Pro Finder is a Manifest V3 Chrome/Edge extension made by **Ultimate Krypton Inc.** It finds playable video URLs on the current page, previews direct video, expands HLS/DASH quality variants when the browser permits the request, and starts downloads through the browser download API.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository folder.
4. Open a page containing a video, select the extension, and use **Rescan** if the page loaded media after the initial scan.
5. For a local smoke test, serve this folder from a local HTTP server and open `demo/test.html`. For example: `python3 -m http.server 8000`, then visit `http://localhost:8000/demo/test.html`.

The default content script is limited to pages where the browser permits the extension to run. Advanced host scanning is opt-in from the options page and requests `<all_urls>` using the optional permission.

## Features

- Detects video elements, source and track children, video links, and URL-shaped values in inline scripts.
- Optional network scanning observes response content types, so media with extensionless or signed URLs can still be listed. Enable it in Advanced options; host access is requested only for that feature.
- Deduplicates sources and records MIME type, host, resolution, bitrate, codecs, poster, subtitles, and a best-effort DRM flag.
- Parses HLS master playlists and DASH manifests with relative URL resolution and highest-quality-first ordering.
- Previews direct MP4/WebM sources and attempts native HLS playback.
- Stores the prompt and per-domain quality choices in `chrome.storage.local`.
- Uses `chrome.downloads` for direct URLs and gives an actionable CORS/authentication or HLS `ffmpeg` fallback when the browser cannot fetch or merge media.
- Attempts to merge accessible, unencrypted HLS segments into a `.ts` download with browser-side size and segment limits; encrypted playlists, DRM, CORS blocks, and authenticated failures are refused rather than bypassed.
- Uses an offscreen document for HLS blob assembly because service workers cannot create object URLs reliably. The offscreen document is created only when an HLS download is requested.
- Includes a gold progress treatment, ETA calculation, download history, context-menu action, and draggable prompt bubbles.

## Default prompt

The exact built-in prompt is:

`Save highest-quality non-DRM stream as MP4; prefer 1080p>720p>480p; include subtitles if available; filename "{title}_{YYYYMMDD}_{quality}.mp4"; auto-save to Downloads; show gold progress bar and ETA.`

Supported variables are `{title}`, `{YYYYMMDD}`, `{quality}`, `{bitrate}`, `{origin}`, and `{ext}`. Filenames are sanitized before being passed to the downloads API. Example prompts to paste into the editor:

- `Save {quality} from {origin} as "{title}_{YYYYMMDD}_{quality}.{ext}".`
- `Prefer non-DRM 1080p; include subtitles; filename "{title}_{quality}_{bitrate}.mp4".`

## Testing

The pure helper modules have no package dependencies. Run:

```sh
node tests/test-harness.js
for file in background.js content.js popup.js options.js lib/*.js tests/test-harness.js; do node --check "$file"; done
python3 -m json.tool manifest.json >/dev/null
```

The harness covers HLS/DASH ordering, relative URLs, ETA smoothing, and filename templating. Browser testing should be done with the unpacked extension and `demo/test.html`; a real HLS endpoint is required to see variant expansion because the sample URL is intentionally non-hosting test data.

## Known limitations

- DRM, encrypted media extensions, blob-only sources, and protected player pipelines cannot be downloaded by this extension. A DRM suspicion is informational only.
- Playlist and authenticated media requests remain subject to CORS, cookies, referrer checks, server permissions, and browser policy. The popup reports a fallback rather than bypassing those controls.
- HLS segment merging is not performed by default in the service worker. Use the displayed permitted URL with `ffmpeg -i "PLAYLIST_URL" -c copy "output.mp4"`, subject to the site's terms and your rights.
- DASH representations can be listed, but browser downloads may require the original manifest/player because representations can depend on initialization and segment templates.
- Subtitle tracks are detected and shown as metadata. The extension does not burn subtitles into video; download the `.vtt` sidecar separately when permitted.
- The extension has no analytics and does not transmit page content or URLs to an external service.

## Packaging and publishing checklist

1. Test the unpacked extension in current Chrome and Edge, including a clean profile.
2. Verify the included Ultimate Krypton Inc. artwork in `icons/ultimate-krypton.svg` and the toolbar icons before publishing.
3. Review host permissions and keep advanced scanning optional.
4. Increment `version` in `manifest.json`, zip the extension contents without development files, and validate the zip by loading it in a clean browser profile.
5. Prepare store screenshots, privacy disclosures, support URL, and a description of the download permissions.
6. Submit through the Chrome Web Store and Microsoft Edge Add-ons portals and respond to permission/privacy review questions.

## Legal and ethics

Use Video Pro Finder only for media you own or are authorized to save. Do not use it to bypass DRM or download copyrighted content without permission. Respect site terms, access controls, copyright, privacy, and applicable law.
