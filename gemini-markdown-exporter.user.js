// ==UserScript==
// @name         Gemini Markdown Exporter
// @namespace    https://github.com/aeonsong/gemini-markdown-exporter
// @version      1.0.0
// @description  Export the current Gemini conversation to clean Markdown while preserving LaTeX, chemistry, code, tables, and citations.
// @author       aeonsong
// @match        https://gemini.google.com/*
// @homepageURL  https://github.com/aeonsong/gemini-markdown-exporter
// @supportURL   https://github.com/aeonsong/gemini-markdown-exporter/issues
// @downloadURL  https://raw.githubusercontent.com/aeonsong/gemini-markdown-exporter/main/gemini-markdown-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/aeonsong/gemini-markdown-exporter/main/gemini-markdown-exporter.user.js
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const UI_TAGS = new Set([
    'BUTTON',
    'GEM-ICON',
    'GEM-ICON-BUTTON',
    'MAT-ICON',
    'THUMB-UP-BUTTON',
    'THUMB-DOWN-BUTTON',
    'REGENERATE-BUTTON',
    'COPY-BUTTON',
    'MESSAGE-ACTIONS',
    'SOURCES-LIST',
    'THINKING-OVERLAY',
    'SENSITIVE-MEMORIES-BANNER',
  ]);

  const PASSTHROUGH_TAGS = new Set([
    'RESPONSE-ELEMENT',
    'LINK-BLOCK',
    'STRUCTURED-CONTENT-CONTAINER',
    'MESSAGE-CONTENT',
    'RESPONSE-CONTAINER',
  ]);

  function classNameOf(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
    return typeof node.className === 'string'
      ? node.className
      : node.getAttribute('class') || '';
  }

  function collapseWs(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function childrenToMarkdown(node) {
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      out += nodeToMarkdown(child);
    }
    return out;
  }

  function extractMathSource(node) {
    const attrs = ['data-math', 'data-latex', 'data-tex'];
    for (const attr of attrs) {
      const value = node.getAttribute?.(attr);
      if (value && value.trim()) return value.trim();
    }

    const annotation = node.querySelector?.(
      'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]'
    );
    if (annotation?.textContent?.trim()) return annotation.textContent.trim();

    return '';
  }

  function isDisplayMath(node, cls) {
    return (
      cls.includes('math-display') ||
      cls.includes('katex-display') ||
      node.matches?.('mjx-container[display="true"]') ||
      node.closest?.('.math-display, .katex-display') === node
    );
  }

  function markdownLink(node) {
    const text = collapseWs(childrenToMarkdown(node));
    const hrefRaw = node.getAttribute('href') || '';
    if (!text) return '';
    if (!hrefRaw) return text;

    let href = hrefRaw;
    try {
      href = new URL(hrefRaw, location.href).href;
    } catch (_) {
      // Keep the original href if URL parsing fails.
    }

    if (
      href.startsWith('https://gemini.google.com/app/') ||
      href.startsWith('https://gemini.google.com/u/')
    ) {
      return text;
    }

    return `[${text}](${href})`;
  }

  function extractCodeText(codeEl) {
    const lines = [];
    let current = '';

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        current += node.textContent || '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'BR') {
        lines.push(current);
        current = '';
        return;
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        walk(child);
      }
    }

    walk(codeEl);
    if (current || lines.length === 0) lines.push(current);
    return lines.join('\n');
  }

  function codeBlockToMarkdown(node) {
    const langNode = node.querySelector('.code-block-decoration > span');
    const langFromClass = Array.from(
      node.querySelector('code')?.classList || []
    )
      .find((name) => name.startsWith('language-'))
      ?.slice('language-'.length);
    const lang = collapseWs(langNode?.textContent || langFromClass || '');
    const codeEl = node.querySelector('code.code-container.formatted, code');
    const code = codeEl ? extractCodeText(codeEl) : node.textContent || '';
    return `\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n`;
  }

  function listToMarkdown(list, depth = 0) {
    const ordered = list.tagName === 'OL';
    const start = Number.parseInt(list.getAttribute('start') || '1', 10) || 1;
    const items = Array.from(list.children).filter((child) => child.tagName === 'LI');

    return items
      .map((li, index) => {
        const prefix = ordered ? `${start + index}.` : '-';
        const indent = '  '.repeat(depth);
        let text = '';
        let nested = '';

        for (let child = li.firstChild; child; child = child.nextSibling) {
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child.tagName === 'UL' || child.tagName === 'OL')
          ) {
            nested += listToMarkdown(child, depth + 1);
          } else {
            text += nodeToMarkdown(child);
          }
        }

        const line = `${indent}${prefix} ${collapseWs(text)}\n`;
        return line + nested;
      })
      .join('');
  }

  function tableCellToMarkdown(cell) {
    return collapseWs(childrenToMarkdown(cell))
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>');
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children)
        .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
        .map(tableCellToMarkdown)
    );

    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row) => {
      while (row.length < width) row.push('');
    });

    const header = rows[0];
    const separator = header.map(() => '---');
    const body = rows.slice(1);
    return [header, separator, ...body]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    const cls = classNameOf(node);

    if (
      cls.includes('cdk-visually-hidden') ||
      cls.includes('screen-reader') ||
      node.getAttribute('aria-hidden') === 'true'
    ) {
      return '';
    }

    if (UI_TAGS.has(tag)) return '';
    if (PASSTHROUGH_TAGS.has(tag)) return childrenToMarkdown(node);

    const mathSource = extractMathSource(node);
    if (
      mathSource &&
      (
        cls.includes('math-inline') ||
        cls.includes('math-display') ||
        cls.includes('katex') ||
        tag === 'MJX-CONTAINER'
      )
    ) {
      return isDisplayMath(node, cls)
        ? `\n\n$$\n${mathSource}\n$$\n\n`
        : `$${mathSource}$`;
    }

    if (tag === 'CODE-BLOCK') return codeBlockToMarkdown(node);

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `\n${'#'.repeat(level)} ${collapseWs(childrenToMarkdown(node))}\n`;
    }

    if (tag === 'P') {
      const content = childrenToMarkdown(node).trim();
      return content ? `\n${content}\n` : '';
    }

    if (tag === 'STRONG' || tag === 'B') return `**${childrenToMarkdown(node)}**`;
    if (tag === 'EM' || tag === 'I') return `*${childrenToMarkdown(node)}*`;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') {
      return `~~${childrenToMarkdown(node)}~~`;
    }

    if (tag === 'CODE' && !node.closest('code-block, pre')) {
      const text = node.textContent || '';
      const ticks = text.includes('`') ? '``' : '`';
      return `${ticks}${text}${ticks}`;
    }

    if (tag === 'PRE' && !node.closest('code-block')) {
      const code = node.querySelector('code');
      const text = code ? extractCodeText(code) : node.textContent || '';
      const lang = Array.from(code?.classList || [])
        .find((name) => name.startsWith('language-'))
        ?.slice('language-'.length) || '';
      return `\n\`\`\`${lang}\n${text.trimEnd()}\n\`\`\`\n`;
    }

    if (tag === 'A') return markdownLink(node);

    if (tag === 'IMG') {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : alt;
    }

    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n---\n';
    if (tag === 'UL' || tag === 'OL') return `\n${listToMarkdown(node)}\n`;

    if (tag === 'BLOCKQUOTE') {
      const content = childrenToMarkdown(node).trim();
      if (!content) return '';
      return `\n${content
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n')}\n`;
    }

    if (tag === 'TABLE') return `\n${tableToMarkdown(node)}\n`;
    if (tag === 'SUP') return `<sup>${childrenToMarkdown(node)}</sup>`;
    if (tag === 'SUB') return `<sub>${childrenToMarkdown(node)}</sub>`;

    return childrenToMarkdown(node);
  }

  function preserveConsecutiveCitations(markdown) {
    const parts = markdown.split(/(```[\s\S]*?```)/g);
    return parts
      .map((part, index) => {
        if (index % 2 === 1) return part;
        return part.replace(
          /(\[\d+\]\([^\n)]+\))\s*(?=\[\d+\]\()/g,
          '$1 / '
        );
      })
      .join('');
  }

  function cleanMarkdown(markdown) {
    let value = preserveConsecutiveCitations(markdown);
    value = value.replace(/[ \t]+\n/g, '\n');
    value = value.replace(/\n{4,}/g, '\n\n\n');
    return value.trim();
  }

  function userTextFromTurn(turn) {
    const query = turn.querySelector('.query-text, user-query');
    if (!query) return '';

    const lines = query.querySelectorAll('p.query-text-line');
    if (lines.length) {
      return Array.from(lines)
        .map((line) => {
          if (line.querySelector('br') && !line.textContent.trim()) return '';
          return line.textContent.trim();
        })
        .join('\n')
        .trim();
    }

    return (query.innerText || query.textContent || '').trim();
  }

  function responseDraftsFromTurn(turn) {
    const containers = turn.querySelectorAll('response-container');
    const drafts = [];

    containers.forEach((container) => {
      const content =
        container.querySelector('structured-content-container > div.container') ||
        container.querySelector('message-content') ||
        container;
      const markdown = cleanMarkdown(nodeToMarkdown(content));
      if (markdown && !drafts.includes(markdown)) drafts.push(markdown);
    });

    if (!drafts.length) {
      const fallback = turn.querySelector('model-response');
      if (fallback) {
        const markdown = cleanMarkdown(nodeToMarkdown(fallback));
        if (markdown) drafts.push(markdown);
      }
    }

    return drafts;
  }

  function getConversationTurns() {
    const history = document.querySelector(
      'infinite-scroller[data-test-id="chat-history-container"]'
    );

    if (history) {
      const turns = Array.from(history.querySelectorAll('.conversation-container'));
      if (turns.length) return turns;
    }

    const blocks = Array.from(document.querySelectorAll('user-query, model-response'));
    const roots = blocks.filter(
      (block) => !blocks.some((other) => other !== block && other.contains(block))
    );

    const synthetic = [];
    let current = null;
    roots.forEach((block) => {
      if (block.tagName === 'USER-QUERY') {
        current = document.createElement('div');
        current.appendChild(block.cloneNode(true));
        synthetic.push(current);
      } else if (block.tagName === 'MODEL-RESPONSE') {
        if (!current) {
          current = document.createElement('div');
          synthetic.push(current);
        }
        current.appendChild(block.cloneNode(true));
      }
    });
    return synthetic;
  }

  function getTitle() {
    const candidates = [
      document.querySelector('[data-test-id="conversation-title"]'),
      document.querySelector('[aria-current="page"]'),
    ];

    for (const candidate of candidates) {
      const text = collapseWs(candidate?.textContent || '');
      if (text && text.length < 200) return text;
    }

    return (
      (document.title || '')
        .replace(/\s*[-–—|]\s*(Google\s*)?Gemini\s*$/i, '')
        .trim() || 'Gemini Conversation'
    );
  }

  function safeFilename(title) {
    return title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  }

  function downloadMarkdown() {
    const turns = getConversationTurns();
    if (!turns.length) {
      alert('[Gemini Markdown Exporter] No conversation messages found.');
      return;
    }

    const sections = [];

    turns.forEach((turn) => {
      const userText = userTextFromTurn(turn);
      if (userText) sections.push(`## You\n\n${userText}`);

      const drafts = responseDraftsFromTurn(turn);
      if (drafts.length === 1) {
        sections.push(`## Gemini\n\n${drafts[0]}`);
      } else if (drafts.length > 1) {
        drafts.forEach((draft, index) => {
          sections.push(`## Gemini ${index + 1}\n\n${draft}`);
        });
      }
    });

    if (!sections.length) {
      alert('[Gemini Markdown Exporter] Conversation content was found, but nothing could be converted.');
      return;
    }

    const title = getTitle();
    const markdown = cleanMarkdown(
      `# ${title}\n\n` +
        `> Source: ${location.href}\n` +
        `> Exported: ${new Date().toLocaleString()}\n\n` +
        `---\n\n` +
        sections.join('\n\n---\n\n')
    );

    const blob = new Blob([markdown + '\n'], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(title) || 'gemini-conversation'}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  GM_registerMenuCommand('Export conversation to Markdown', downloadMarkdown);

  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      downloadMarkdown();
    }
  });
})();
