(() => {
  "use strict";
  if (globalThis.__GEMINI_MD_EXPORTER__) return;
  globalThis.__GEMINI_MD_EXPORTER__ = true;

  const VERSION = "1.0.0";
  const CITE_SEP = " / ";
  const TURN_SELECTOR = [
    "user-query", "model-response",
    '[data-message-author-role="user"]',
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="model"]',
    '[data-message-role="user"]',
    '[data-message-role="assistant"]',
    '[data-message-role="model"]'
  ].join(",");

  const norm = v => String(v ?? "").replace(/\u00a0/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
  const trim = v => norm(v).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  const abs = href => {
    try { return new URL(href, location.href).href; } catch { return href || ""; }
  };
  const fenceFor = s => "`".repeat(Math.max(3, ...((s.match(/`+/g) || []).map(x => x.length + 1))));
  const safeFile = s => (trim(s).replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").slice(0, 120) || "gemini-conversation") + ".md";
  const escCell = s => trim(s).replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>");

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "user-query") return "user";
    if (tag === "model-response") return "assistant";
    const r = (el.getAttribute("data-message-author-role") || el.getAttribute("data-message-role") || "").toLowerCase();
    return r === "user" ? "user" : (r === "assistant" || r === "model" ? "assistant" : "");
  }

  function contentRoot(turn) {
    const selectors = roleOf(turn) === "assistant"
      ? ['message-content .markdown', ".markdown", "message-content", '[class*="model-response-text"]']
      : ['[class*="query-text"]', '[class*="user-query-content"]', "message-content"];
    for (const s of selectors) {
      const hit = turn.querySelector(s);
      if (hit && trim(hit.textContent)) return hit;
    }
    return turn;
  }

  function texOf(el) {
    const ann = el.querySelector?.('annotation[encoding="application/x-tex"],annotation[encoding="application/x-latex"],.katex-mathml annotation');
    if (ann?.textContent?.trim()) return stripMath(ann.textContent);
    for (const a of ["data-latex","data-latex-source","data-tex","data-math","data-equation","data-formula","alttext"]) {
      const v = el.getAttribute?.(a);
      if (v?.trim()) return stripMath(v);
    }
    const aria = el.getAttribute?.("aria-label");
    return aria && /[\\{}_^=]/.test(aria) ? stripMath(aria) : "";
  }

  function stripMath(s) {
    s = trim(s);
    let m = s.match(/^\\\[([\s\S]*)\\\]$/); if (m) return trim(m[1]);
    m = s.match(/^\\\(([\s\S]*)\\\)$/); if (m) return trim(m[1]);
    if (s.startsWith("$$") && s.endsWith("$$")) return trim(s.slice(2,-2));
    if (s.startsWith("$") && s.endsWith("$") && !s.startsWith("$$")) return trim(s.slice(1,-1));
    return s;
  }

  function isDisplayMath(el) {
    return el.matches?.('.katex-display,mjx-container[display="true"],math[display="block"],[data-display="block"],[data-display="true"]') ||
      !!el.closest?.('.katex-display,mjx-container[display="true"],[data-display="block"],[data-display="true"]');
  }

  function prepare(root) {
    const formulas = [];
    const protectedText = [];
    const clone = root.cloneNode(true);

    const mathNodes = Array.from(clone.querySelectorAll([
      ".katex-display",".katex","mjx-container","math",
      "[data-latex]","[data-latex-source]","[data-tex]","[data-math]","[data-equation]","[data-formula]"
    ].join(",")));
    const chosen = [];
    for (const el of mathNodes) {
      if (chosen.some(p => p.contains(el))) continue;
      const tex = texOf(el);
      if (!tex) continue;
      chosen.push(el);
      const token = `\uE000M${formulas.length}\uE001`;
      formulas.push({ token, text: isDisplayMath(el) ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$` });
      el.replaceWith(document.createTextNode(token));
    }

    const cue = el => /citation|source|grounding|attribution|footnote/.test(
      [el.id, el.className, el.getAttribute?.("aria-label"), el.getAttribute?.("data-test-id"), el.getAttribute?.("data-testid")].filter(x => typeof x === "string").join(" ").toLowerCase()
    );

    for (const el of clone.querySelectorAll('a[href],button,[role="button"],sup')) {
      const t = trim(el.textContent);
      const m = t.match(/^\[?(\d{1,3})\]?$/);
      if (!m) continue;
      if (el.tagName === "A" || el.tagName === "SUP" || cue(el)) {
        el.setAttribute("data-gme-cite", m[1]);
      }
    }

    clone.querySelectorAll("script,style,noscript,template,svg,canvas,video,audio,input,textarea,select,option,mat-icon,.mat-icon,.mat-mdc-tooltip,[role=tooltip],[role=menu],[role=menuitem],[aria-hidden=true]").forEach(el => el.remove());
    clone.querySelectorAll("button,[role=button]").forEach(el => { if (!el.hasAttribute("data-gme-cite")) el.remove(); });

    const protect = text => {
      const token = `\uE010P${protectedText.length}\uE011`;
      protectedText.push({ token, text });
      return token;
    };
    return { clone, formulas, protectedText, protect };
  }

  function language(pre, code) {
    for (const x of [code?.dataset?.language, pre?.dataset?.language, code?.getAttribute?.("lang"), pre?.getAttribute?.("lang"), code?.className, pre?.className]) {
      if (!x || typeof x !== "string") continue;
      const m = x.match(/(?:^|\s)language-([A-Za-z0-9_+#.-]+)/);
      if (m) return m[1];
      if (/^[A-Za-z0-9_+#.-]{1,20}$/.test(x)) return x;
    }
    return "";
  }

  function render(root, protect) {
    const children = (el, ctx={}) => Array.from(el.childNodes).map(n => node(n, ctx)).join("");
    const block = s => trim(s) ? `\n\n${trim(s)}\n\n` : "";

    function list(el, ordered, ctx) {
      const items = Array.from(el.children).filter(x => x.tagName.toLowerCase() === "li");
      const start = ordered ? Number(el.getAttribute("start") || 1) : 1;
      return "\n\n" + items.map((li,i) => {
        const nested = Array.from(li.children).filter(x => /^(UL|OL)$/.test(x.tagName));
        let main = Array.from(li.childNodes).filter(x => !(x.nodeType === 1 && nested.includes(x))).map(n => node(n, ctx)).join("");
        main = trim(main).replace(/\n{2,}/g,"\n");
        const marker = ordered ? `${start+i}. ` : "- ";
        let out = marker + main.split("\n").map((x,j)=>j? " ".repeat(marker.length)+x:x).join("\n");
        for (const nl of nested) out += "\n" + trim(list(nl,nl.tagName==="OL",ctx)).split("\n").map(x=>"  "+x).join("\n");
        return out;
      }).join("\n") + "\n\n";
    }

    function table(el, ctx) {
      const rows = Array.from(el.rows || []);
      if (!rows.length) return "";
      const data = rows.map(r => Array.from(r.cells || []).map(c => escCell(children(c,ctx))));
      const cols = Math.max(...data.map(r=>r.length));
      data.forEach(r => { while(r.length<cols) r.push(""); });
      const line = r => `| ${r.join(" | ")} |`;
      return `\n\n${line(data[0])}\n${line(Array(cols).fill("---"))}\n${data.slice(1).map(line).join("\n")}\n\n`;
    }

    function node(n, ctx={}) {
      if (n.nodeType === Node.TEXT_NODE) return norm(n.nodeValue);
      if (n.nodeType !== Node.ELEMENT_NODE) return "";
      const el = n, tag = el.tagName.toLowerCase();

      if (el.hasAttribute("data-gme-cite")) {
        const num = el.getAttribute("data-gme-cite");
        const a = tag === "a" ? el : el.querySelector("a[href]");
        const href = abs(a?.getAttribute("href"));
        return href ? `[${num}](${href})` : `[${num}]`;
      }

      if (/^h[1-6]$/.test(tag)) return block(`${"#".repeat(Number(tag[1]))} ${trim(children(el,ctx))}`);
      if (tag === "p") return block(children(el,ctx));
      if (["div","section","article","main","header","footer"].includes(tag)) {
        const body = children(el,ctx); const hasBlock = Array.from(el.children).some(x => /^(P|DIV|SECTION|ARTICLE|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE|HR|DETAILS)$/.test(x.tagName));
        return hasBlock ? block(body) : body;
      }
      if (tag === "br") return "\n";
      if (tag === "hr") return "\n\n---\n\n";
      if (tag === "strong" || tag === "b") { const s=trim(children(el,ctx)); return s?`**${s}**`:""; }
      if (tag === "em" || tag === "i") { const s=trim(children(el,ctx)); return s?`*${s}*`:""; }
      if (tag === "s" || tag === "del" || tag === "strike") { const s=trim(children(el,ctx)); return s?`~~${s}~~`:""; }
      if (tag === "code" && el.parentElement?.tagName.toLowerCase() !== "pre") {
        const s=norm(el.textContent); const ticks="`".repeat(Math.max(1,...((s.match(/`+/g)||[]).map(x=>x.length+1))));
        return protect(`${ticks}${(/^\s|\s$/.test(s)||s.startsWith("`")||s.endsWith("`"))?" "+s+" ":s}${ticks}`);
      }
      if (tag === "pre") {
        const c=el.querySelector(":scope > code")||el.querySelector("code"), raw=norm(c?.textContent ?? el.textContent).replace(/^\n|\n$/g,"");
        const f=fenceFor(raw); return `\n\n${protect(`${f}${language(el,c)}\n${raw}\n${f}`)}\n\n`;
      }
      if (tag === "a") {
        const body=trim(children(el,ctx)), href=abs(el.getAttribute("href")); if(!href) return body; if(!body) return `<${href}>`;
        const title=el.getAttribute("title"); return `[${body.replace(/]/g,"\\]")}](${href}${title?` "${title.replace(/"/g,'\\"')}"`:""})`;
      }
      if (tag === "img") {
        const src=abs(el.getAttribute("src")); if(!src||/^data:/i.test(src)) return "";
        return `![${(el.getAttribute("alt")||"").replace(/]/g,"\\]")}](${src})`;
      }
      if (tag === "blockquote") return block(trim(children(el,ctx)).split(/\r?\n/).map(x=>`> ${x}`).join("\n"));
      if (tag === "ul") return list(el,false,ctx);
      if (tag === "ol") return list(el,true,ctx);
      if (tag === "li") return children(el,ctx);
      if (tag === "table") return table(el,ctx);
      if (["thead","tbody","tfoot","tr","th","td"].includes(tag)) return children(el,ctx);
      if (tag === "sup") { const s=trim(children(el,ctx)); return s?`<sup>${s}</sup>`:""; }
      if (tag === "sub") { const s=trim(children(el,ctx)); return s?`<sub>${s}</sub>`:""; }
      if (tag === "summary") { const s=trim(children(el,ctx)); return s?`**${s}**\n\n`:""; }
      return children(el,ctx);
    }
    return children(root);
  }

  function finalize(raw, formulas, protectedText) {
    let s = trim(raw).replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n");
    s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_,x)=>`\n\n$$\n${trim(x)}\n$$\n\n`).replace(/\\\(([\s\S]*?)\\\)/g,(_,x)=>`$${trim(x)}$`);
    s = s.replace(/(^|[^$\\])\\ce\{([^{}\n]+)\}/g,(_,p,x)=>`${p}$\\ce{${x}}$`);
    s = s.replace(/(\[\d{1,3}\]\([^\n)]+\)|\[\d{1,3}\])[ \t]*(?=\[\d{1,3}\](?:\(|(?!\())])/g, `$1${CITE_SEP}`);
    for (const x of formulas) s = s.split(x.token).join(x.text);
    for (const x of protectedText) s = s.split(x.token).join(x.text);
    return trim(s).replace(/\n{3,}/g,"\n\n") + "\n";
  }

  function findTurns() {
    const all=Array.from(document.querySelectorAll(TURN_SELECTOR)).map(node=>({node,role:roleOf(node)})).filter(x=>x.role);
    all.sort((a,b)=>a.node===b.node?0:(a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1));
    return all.filter((x,i)=>!all.slice(0,i).some(y=>y.role===x.role && y.node.contains(x.node)));
  }

  function title() {
    const d=trim(document.title).replace(/\s*[-–—|]\s*Gemini\s*$/i,"").replace(/^Gemini\s*[-–—|]\s*/i,"");
    if (d && !/^Gemini$/i.test(d)) return d;
    return Array.from(document.querySelectorAll("h1")).map(x=>trim(x.textContent)).find(x=>x&&!/^Gemini$/i.test(x)) || "Gemini Conversation";
  }

  function buildMarkdown() {
    const turns=findTurns(); if(!turns.length) throw new Error("No Gemini conversation turns found in the current page DOM.");
    const out=[`# ${title()}`,"",`> Source: ${location.href}`,`> Exported: ${new Date().toISOString()}`,"","---",""];
    let n=0;
    for(const turn of turns){
      const {clone,formulas,protectedText,protect}=prepare(contentRoot(turn));
      const body=finalize(render(clone,protect),formulas,protectedText);
      if(!trim(body)) continue;
      out.push(turn.role==="user"?"## You":"## Gemini","",trim(body),""); n++;
    }
    if(!n) throw new Error("Gemini turns were found, but no exportable message content was detected.");
    return out.join("\n").replace(/\n{3,}/g,"\n\n").trim()+"\n";
  }

  function exportConversation() {
    const markdown=buildMarkdown(), blob=new Blob([markdown],{type:"text/markdown;charset=utf-8"}), url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=safeFile(title()); a.style.display="none";
    document.documentElement.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500); return markdown;
  }

  function installButton() {
    if(!document.body || document.getElementById("gme-exporter-host")) return;
    const host=document.createElement("div"); host.id="gme-exporter-host";
    Object.assign(host.style,{position:"fixed",right:"20px",bottom:"20px",zIndex:"2147483647"});
    const shadow=host.attachShadow({mode:"open"}), b=document.createElement("button"), style=document.createElement("style");
    b.textContent="Export MD"; b.title="Export Gemini conversation to Markdown (Alt+Shift+M)";
    style.textContent=`button{appearance:none;border:1px solid rgba(0,0,0,.16);border-radius:999px;background:#fff;color:#1f1f1f;box-shadow:0 2px 10px rgba(0,0,0,.14);cursor:pointer;font:600 13px/1 system-ui,-apple-system,sans-serif;padding:10px 14px}button:hover{background:#f7f7f7}button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}`;
    b.onclick=()=>{try{exportConversation();b.textContent="Exported";setTimeout(()=>b.textContent="Export MD",1200)}catch(e){console.error("[Gemini Markdown Exporter]",e);b.textContent="Export failed";setTimeout(()=>b.textContent="Export MD",1600)}};
    shadow.append(style,b); document.body.appendChild(host);
  }

  document.addEventListener("keydown",e=>{if(e.altKey&&e.shiftKey&&!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==="m"){e.preventDefault();try{exportConversation()}catch(err){console.error("[Gemini Markdown Exporter]",err)}}});
  globalThis.GeminiMarkdownExporter=Object.freeze({version:VERSION,buildMarkdown,exportConversation});
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",installButton,{once:true}); else installButton();
})();