# Changelog

## 1.4.0

- Add native AsciiDoc syntax highlighting, snippets, keyboard shortcuts, document symbols, breadcrumbs, and folding ranges.
- Add workspace-aware completion for xrefs, anchors, includes, and images, including `imagesdir` path handling.
- Add Go to Definition, document links, Find All References, and safe cross-file rename for explicit AsciiDoc anchors.
- Add Problems Panel Quick Fixes for misspelled local paths and anchors.
- Refresh diagnostics and open previews when referenced documents, stylesheets, images, or includes change.
- Highlight the current source block in the preview while keeping caret and scroll synchronization loop-safe.
- Keep the live workspace index bounded and exclude dependency, build, coverage, artifact, Git, and test-output directories.

## 1.3.1

- Rewrite the Marketplace README as a product-focused guide without development logs or hard-coded release details.
- Improve Marketplace categories, keywords, pricing, and gallery metadata.
- Restrict the VSIX to an explicit allowlist of runtime files, public documentation, licensing information, and the PNG icon.

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
