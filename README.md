# Gemini Markdown Exporter

A lightweight userscript for exporting the current Gemini conversation to a clean Markdown (`.md`) file.

It is designed to preserve the semantic content that matters when Gemini's rendered DOM is converted back to Markdown, especially formulas, chemical notation, code blocks, tables, links, and citations.

## Features

- Exports the current Gemini conversation in document order with `You` / `Gemini` sections.
- Preserves inline and display LaTeX as `$...$` and `$$...$$`.
- Preserves chemistry expressions such as `\ce{H2O}` and `\ce{CO2}` instead of flattening rendered formula DOM.
- Preserves fenced code blocks and common language hints.
- Converts headings, paragraphs, emphasis, blockquotes, lists, tables, links, images, superscript/subscript, and horizontal rules.
- Keeps Gemini source links and inserts ` / ` between consecutive numeric citations so multiple sources do not visually collapse into one long number sequence.
- Provides a userscript menu command and `Alt+Shift+M` shortcut.
- Runs locally in the browser with no external runtime dependencies or network requests.

## Install

Install a userscript manager such as **Tampermonkey** or **Violentmonkey**, then install:

**[gemini-markdown-exporter.user.js](https://raw.githubusercontent.com/aeonsong/gemini-markdown-exporter/main/gemini-markdown-exporter.user.js)**

Your userscript manager should recognize the `.user.js` file and show its normal installation page. Confirm installation, then open or reload a conversation at `https://gemini.google.com/`.

No unpacked Chrome extension or `chrome://extensions` setup is required.

## Use

On a Gemini conversation page, either:

- choose **Export conversation to Markdown** from the Tampermonkey/Violentmonkey userscript menu; or
- press `Alt+Shift+M`.

The script downloads a Markdown file named from the current Gemini conversation title when available.

## Formula handling

Gemini normally renders formulas into KaTeX/MathJax-like DOM. Exporting only the visible text of that rendered DOM can destroy the original TeX source. The userscript therefore looks for underlying TeX annotations/data before converting the rest of the DOM to Markdown.

Examples:

```text
\(E = mc^2\)        -> $E = mc^2$
\[E = mc^2\]        -> $$E = mc^2$$
\ce{H2O}             -> preserved inside the math expression
```

Rendering `\ce{...}` in the exported Markdown still depends on the destination Markdown renderer supporting the relevant chemistry extension, commonly MathJax/KaTeX with `mhchem`. The exporter preserves the source expression; it does not attempt to reproduce viewer-specific CSS or layout. If a destination viewer shows formula overlap or clipping while the TeX source is intact, that is a renderer/layout issue rather than an export transformation issue.

## Citation formatting

Consecutive numeric source citations are deliberately separated:

```markdown
[1](https://example.com/a) / [2](https://example.com/b) / [3](https://example.com/c)
```

This avoids output that visually resembles one continuous number sequence.

## Repository

```text
gemini-markdown-exporter/
├── gemini-markdown-exporter.user.js
├── README.md
└── LICENSE
```

The userscript is intentionally dependency-free. Its main stages are:

1. Locate user/model turns in Gemini's DOM.
2. Read each message without modifying the live page.
3. Preserve formula source and citation semantics.
4. Convert the rendered content to Markdown.
5. Normalize citation spacing and Markdown whitespace.
6. Download the result using a local Blob URL.

## Compatibility notes

Gemini is a web application and its internal DOM is not a public API. The userscript uses multiple selectors and fallbacks, but future Gemini UI changes can require selector updates.

For very long conversations, export completeness also depends on the conversation turns being present in the page DOM. If Gemini introduces stronger virtualization, additional scrolling/materialization logic may be required.

## Privacy

The userscript processes the current Gemini page locally in the browser. It does not send conversation content to an external service.

## License

MIT License. See [LICENSE](LICENSE).
