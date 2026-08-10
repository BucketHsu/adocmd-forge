# Changelog

## 1.3.0

- Synchronize the preview with the active source-editor line when the caret moves.
- Keep caret navigation, source scrolling, and preview scrolling on the same loop-safe synchronization flow.
- Restore the current caret position after opening or refreshing a preview.

## 1.2.0–1.2.9

- Add a floating formatting palette and source, split, and preview-only layouts.
- Add HTML, standalone HTML, embedded HTML, and Asciidoctor PDF export.
- Support Windows RubyGems installations of `asciidoctor-pdf`.
- Resolve relative PDF themes and font directories from the source document directory.
- Load local AsciiDoc stylesheets from safe document and workspace paths.
- Add secure nested AsciiDoc includes with line and tag selection.
- Improve title-bar actions, preview spacing, and export destination handling.

## 1.1.0

- Add source-editor formatting commands for AsciiDoc and Markdown.
- Add document layout commands and PDF export configuration.
- Add local AsciiDoc stylesheet support.

## 1.0.0

- Add live AsciiDoc and Markdown preview with synchronized scrolling and VS Code theme support.
- Add AsciiDoc completion, Hover help, and a Traditional Chinese syntax guide.
- Add image drag, paste, import, and automatic image syntax insertion.
- Add document Outline navigation, local link diagnostics, and Problems Panel integration.
- Add HTML export and workspace security boundaries.
