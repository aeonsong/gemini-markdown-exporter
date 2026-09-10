# Gemini Markdown Exporter

A lightweight Chrome extension content script that exports the current Gemini conversation to a clean Markdown (`.md`) file.

The exporter is designed around one practical requirement: preserve the semantic content that matters when Gemini's rendered DOM is converted back to Markdown, especially formulas, chemical notation, code blocks, tables, lists, links, and citations.

## Features

- Exports the current Gemini conversation in document order with `You` / `Gemini` sections.
- Preserves inline and display LaTeX as `$...$` and `$$...$$`.
- Normalizes legacy `\(...\)` and `\[...\]` delimiters outside code blocks.
- Preserves chemistry expressions such as `\ce{H2O}` and `\ce{CO2}` instead of flattening the rendered formula DOM.
- Preserves fenced code blocks and detects common `language-*` classes.
- Converts headings, paragraphs, emphasis, blockquotes, lists, tables, links, images, superscript/subscript, and horizontal rules.
- Keeps Gemini source links and inserts ` / ` between consecutive numeric citations so multiple sources do not visually collapse into one long number sequence.
- Adds a small `Export MD` button on Gemini pages and supports `Alt+Shift+M` as a shortcut.
- No external runtime dependencies and no network requests.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository directory.
5. Open or reload a conversation at `https://gemini.google.com/`.

## Use

Click **Export MD** in the lower-right corner of the Gemini page, or press `Alt+Shift+M`.

The extension downloads a Markdown file named from the current Gemini conversation title when available.

## Formula handling

Gemini normally renders formulas into KaTeX/MathJax-like DOM. Exporting the visible text of that rendered DOM can destroy the original TeX source. This exporter therefore looks for the underlying TeX annotation/data first and replaces the rendered formula with a protected placeholder before converting the rest of the DOM to Markdown.

Examples:

```text
\(E = mc^2\)        -> $E = mc^2$
\[E = mc^2\]        -> $$E = mc^2$$
\ce{H2O}             -> preserved inside the math expression
```

Rendering `\ce{...}` in the exported Markdown still depends on the destination Markdown renderer supporting the relevant chemistry extension (commonly MathJax/KaTeX with `mhchem`). The exporter preserves the source expression; it does not attempt to reproduce viewer-specific CSS or layout. If a destination viewer shows formula overlap or clipping while the TeX source is intact, that is a renderer/layout issue rather than an export transformation issue.

## Citation formatting

Consecutive numeric source citations are deliberately separated:

```markdown
[1](https://example.com/a) / [2](https://example.com/b) / [3](https://example.com/c)
```

This avoids output that visually resembles one continuous number sequence.

## Architecture

```text
gemini-markdown-exporter/
├── manifest.json
├── src/
│   └── content.js
├── README.md
└── LICENSE
```

`src/content.js` is intentionally dependency-free. The main stages are:

1. Locate user/model turns in Gemini's DOM.
2. Clone each message subtree so the live page is never modified.
3. Preserve formula source and citation semantics before cleanup.
4. Convert the cloned DOM with a small purpose-built HTML-to-Markdown renderer.
5. Normalize formula delimiters and citation spacing.
6. Download the final Markdown using a Blob URL.

## Compatibility notes

Gemini is a web application and its internal DOM is not a public API. The exporter uses multiple selectors and fallbacks, but future Gemini UI changes can require selector updates.

For very long conversations, export completeness also depends on the conversation turns being present in the page DOM. If Gemini introduces stronger virtualization, additional scrolling/materialization logic may be required.

## Privacy

The extension processes the current page locally in the browser. It does not send conversation content to an external service.

## License

MIT License. See [LICENSE](LICENSE).
