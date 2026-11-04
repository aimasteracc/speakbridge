# UI asset notices

This notice covers the UI assets reviewed for the SpeakBridge redesign. It is
not a complete license inventory of speech models, native runtimes or all npm
dependencies. Their own licenses and notices continue to apply.

## Lucide React 0.468.0

Navigation and action icons use `lucide-react`, distributed under the ISC
license. Some icons derive from Feather and retain its MIT terms.

- Installed-version copyright and ISC permission notice: [licenses/Lucide-ISC.txt](licenses/Lucide-ISC.txt)
- Feather copyright and MIT permission notice: [licenses/Feather-MIT.txt](licenses/Feather-MIT.txt)
- Upstream: <https://github.com/lucide-icons/lucide/tree/0.468.0>
- License explanation: <https://lucide.dev/license>
- Feather license source: <https://github.com/feathericons/feather/blob/v4.29.2/LICENSE>

Keep both notices with source and redistributed application builds. Do not
replace them with this project's MIT license or remove upstream notices.

## Project artwork and fonts

`build/icon.svg` is editable artwork in this project; `scripts/make-icon.cjs`
generates `build/icon.png`. The reviewed `electron/tray.png` is byte-identical
to that PNG. These files remain under the project's license. This inventory
does not establish trademark clearance or exclusive rights in a visual design.

The application UI uses installed operating-system fonts, without redistributing
font files or loading fonts from a remote service. Any future bundled font must
have its own verified license and required notices.

## Design tooling

UI UX Pro Max is an external design tool, not application runtime code. Its
pinned source and MIT notice are documented in the
[archived design review](docs/archive/design/review.md). Generated concept images
are review material, not a source of production icon glyphs.
The production UI must use the verified SVG icon library or documented project
artwork; do not extract assets from a reference application's screenshots.

## Local workspace dependencies (0.8.0)

- `docx` 9.15.2, MIT: [original notice](licenses/Docx-MIT.txt), [upstream](https://github.com/dolanmiu/docx).
- `unified` 11.0.5 and `remark-parse` 11.0.0, MIT: [unified notice](licenses/Unified-MIT.txt), [remark-parse notice](licenses/RemarkParse-MIT.txt). Markdown exports use these packages alongside the existing `remark-gfm`.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0, Apache-2.0: [JavaScript license](licenses/TesseractJS-Apache-2.0.txt), [core license](licenses/TesseractCore-Apache-2.0.txt), [upstream](https://github.com/naptha/tesseract.js). Language data is downloaded on first use from `tessdata.projectnaptha.com`, not bundled with the app; the upstream Tesseract language-data terms apply.
- Native OCR image-library notices (Leptonica, JPEG, PNG, TIFF, WebP, GIF, zlib and Openlibm), with pinned source references: [OCR notices](licenses/OCR-SOURCES.md). This software is based in part on the work of the Independent JPEG Group.
- Language codes follow the factual list in [OpenAI Whisper](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py); Qwen language names follow the [Qwen3-ASR model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B). No model weights or proprietary application code are included in these tables.

Keep the dependency packages' own license files in redistributed builds. The new UI continues to use the Lucide/Feather notices above; it does not reuse Speakly assets. This list supplements the earlier UI inventory and is not a complete audit of every transitive native library.
