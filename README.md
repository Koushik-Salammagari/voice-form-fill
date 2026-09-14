# Voice Form Fill

A Chrome extension (Manifest V3) that lets you fill out a web form by talking instead of typing. Speak a sentence, and it's parsed into the individual fields of whatever form is on the current page.

## What it does and why

Type "my name is Sarah Connor, my email is sarah@example.com" out loud, and the extension detects the fillable fields on the page you're on, sends your recording to AssemblyAI's Dictation API along with the list of those fields, and writes the parsed values into the matching inputs.

It's aimed at forms where the information being entered is new or said in the moment — a phone intake form, a one-off signup, notes from a conversation — not fields that autofill or a saved profile would already cover. For that kind of data, retyping the same thing by hand into a form is the problem this solves.

## Architecture

- **`content.js`** — the core of the extension. Injected into every page. It:
  - detects fillable `input`/`textarea`/`select` elements and derives a human-readable label for each (checking `label[for]`, a wrapping `<label>`, `aria-label`, `aria-labelledby`, `placeholder`, nearby text, then falling back to the `name`/`id` attribute), retrying detection a few times over ~1.5s if the first pass finds nothing — needed for JS-rendered forms like Google Forms, where inputs aren't in the DOM yet at page load
  - injects a small floating panel (bottom-right corner of the page, Shadow DOM so page styles can't interfere) showing the detected fields and a record/stop button
  - handles the actual microphone recording (`getUserMedia`, `MediaRecorder`) and converts the recording to a 16-bit PCM WAV file
  - fills the DOM fields with the values it gets back, using each field's native property setter plus dispatched `input`/`change` events so both plain HTML forms and React-style controlled inputs pick up the change, and briefly highlights each filled field

- **`background.js`** — the service worker. Receives the recorded audio from `content.js`, asks that same tab for its detected field list, builds an `llm_instruction` telling AssemblyAI's Dictation API to return a JSON object with exactly those field keys, `POST`s the audio and instruction to `https://dictation.assemblyai.com/transcribe`, parses the JSON out of the response's `llm_response` field, and sends the resulting values back to `content.js` to fill in.

- **`options.html` / `options.js`** — a settings page for pasting in your AssemblyAI API key, stored locally via `chrome.storage.local`. Nothing is sent anywhere except in the request to AssemblyAI's API.

- **`popup.html` / `popup.js`** — minimal. Clicking the toolbar icon just points you at the floating panel on the page and links to the settings page; recording itself no longer happens here.

## Setup

1. Get an API key from AssemblyAI.
2. In Chrome, go to `chrome://extensions`, enable Developer mode, and click "Load unpacked" — select this project folder.
3. Click the extension's toolbar icon, then the Settings link, and paste in your API key.
4. Go to any page with a form. Look for the floating panel in the bottom-right corner, click the mic button, speak, click it again to stop.

## Known limitations

- **Field labeling is heuristic, not guaranteed.** It works well on standard HTML forms with real `<label>` elements. On some JS-heavy pages, the actual label text isn't exposed the way the heuristics expect — for example, Google Forms' paragraph-style questions sometimes fall back to a generic placeholder rather than the real question text.
- **Microphone permission is requested per-website**, not once for the whole extension. This is a deliberate tradeoff: recording happens via the content script (running in the page itself) specifically because Chrome auto-dismisses the mic permission prompt when it's requested from a popup or an offscreen document. Running it in the page fixes that, at the cost of a separate permission grant per site.
- **Single-shot dictation, not streaming.** You record a clip, then it's sent for transcription and parsing after you stop — there's no real-time/live transcription.
- **English only, no custom vocabulary.** The Dictation API request doesn't currently set `language_codes` or `keyterms_prompt`, so there's no language selection or vocabulary biasing (e.g. for names or jargon the model might otherwise mishear).
