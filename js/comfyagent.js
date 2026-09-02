import { app } from "../../scripts/app.js";

/* =========================================================================
 *  ComfyAgent – AI Assistant Sidebar for ComfyUI
 *  Fixes applied: XSS prevention, sessionStorage restart wiring,
 *  proactive foreground trigger, approval modals for installs/cloud,
 *  github_token field, ComfyUI menu compat, workflow queue trigger.
 * ========================================================================= */

const MASKED_VALUE = "__COMFYAGENT_MASKED__";

// ── Inject Styles ──────────────────────────────────────────────────────────

const styleTag = document.createElement("style");
styleTag.id = "comfyagent-style";
styleTag.textContent = `
.comfyagent-panel {
    position: fixed;
    top: 50px;
    right: 16px;
    width: 400px;
    height: calc(100vh - 80px);
    background: #1a1a22;
    border: 1px solid #2d2d3a;
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #e0e0e0;
    transition: transform 0.25s ease, opacity 0.25s ease;
    overflow: hidden;
}
.comfyagent-panel.hidden {
    display: none;
}
/* Header */
.ca-header {
    padding: 10px 14px;
    background: #22222c;
    border-bottom: 1px solid #333342;
    border-radius: 12px 12px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
}
.ca-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: move;
    user-select: none;
}
.ca-resize-handle {
    position: absolute;
    width: 18px;
    height: 18px;
    z-index: 3;
    opacity: 0.9;
}
.ca-resize-handle::after {
    content: "";
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 8px;
    height: 8px;
    border-right: 2px solid #7b8192;
    border-bottom: 2px solid #7b8192;
    border-radius: 0 0 2px 0;
}
.ca-resize-nw { left: 0; top: 0; cursor: nwse-resize; }
.ca-resize-nw::after { left: 5px; right: auto; top: 5px; bottom: auto; border: 0; border-left: 2px solid #7b8192; border-top: 2px solid #7b8192; }
.ca-resize-ne { right: 0; top: 0; cursor: nesw-resize; }
.ca-resize-ne::after { right: 5px; top: 5px; bottom: auto; border: 0; border-right: 2px solid #7b8192; border-top: 2px solid #7b8192; }
.ca-resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }
.ca-resize-sw::after { left: 5px; bottom: 5px; right: auto; top: auto; border: 0; border-left: 2px solid #7b8192; border-bottom: 2px solid #7b8192; }
.ca-resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
.ca-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #2e4a2e;
    color: #7ae07a;
}
.ca-controls { display: flex; gap: 4px; }
.ca-controls button {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 15px;
    padding: 2px 5px;
    border-radius: 4px;
}
.ca-controls button:hover { color: #fff; background: #333; }
/* Messages */
.ca-messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ca-msg {
    max-width: 90%;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
}
.ca-msg.user {
    align-self: flex-end;
    background: #2563eb;
    color: #fff;
    position: relative;
}
.ca-msg { position: relative; }
.ca-thinking {
    align-self: flex-start;
    width: 92%;
    flex: 0 0 auto;
    min-height: 34px;
    background: #1e232e;
    border: 1px solid #2e3444;
    border-radius: 8px;
    overflow: hidden;
    font-size: 12px;
    max-height: 260px;
}
.ca-thinking summary {
    cursor: pointer;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #94a3b8;
    user-select: none;
    list-style: none;
    min-height: 34px;
    box-sizing: border-box;
}
.ca-thinking summary::-webkit-details-marker { display: none; }
.ca-thinking[open] summary { border-bottom: 1px solid #2e3444; background: #222838; }
.ca-thinking-badges { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.ca-badge-tool {
    background: #2a3347;
    color: #cbd5e1;
    padding: 2px 7px;
    border-radius: 10px;
    font-size: 10px;
    border: 1px solid #334155;
}
.ca-badge-tool.pending { background: #3a2e1a; color: #fcd34d; border-color: #92400e; }
.ca-badge-tool.done { background: #1e3a2e; color: #86efac; border-color: #166534; }
.ca-thinking-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; height: auto; max-height: 210px; min-height: 20px; overscroll-behavior: contain; }
.ca-tool-row {
    background: #181e2a;
    border: 1px solid #2e3444;
    border-radius: 6px;
    padding: 6px 8px;
    min-height: 22px;
    flex: 0 0 auto;
}
.ca-tool-row b { color: #e2e8f0; font-size: 11px; }
.ca-tool-row pre {
    margin: 4px 0 0;
    background: #0f141f;
    border: 1px solid #1e293b;
    border-radius: 4px;
    padding: 6px;
    font-size: 11px;
    color: #cbd5e1;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 140px;
    overflow-y: auto;
}
.ca-revert {
    position: absolute;
    top: 4px;
    right: 6px;
    background: rgba(0,0,0,0.35);
    border: none;
    color: #aaa;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
.ca-msg:hover .ca-revert { opacity: 1; }
.ca-revert:hover { color: #fff; background: rgba(0,0,0,0.55); }
.ca-question {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 10px;
    margin: 6px 0;
    width: 92%;
    align-self: flex-start;
}
.ca-question h4 { margin: 0 0 4px; font-size: 13px; color: #e2e8f0; }
.ca-question p { margin: 0 0 8px; font-size: 12px; color: #94a3b8; }
.ca-question .ca-qopts { display: flex; flex-direction: column; gap: 6px; }
.ca-qopt {
    background: #334155;
    border: 1px solid #475569;
    color: #e2e8f0;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
}
.ca-qopt:hover { background: #2563eb; border-color: #1d4ed8; }
.ca-qopt small { display: block; color: #94a3b8; font-size: 11px; margin-top: 2px; }
.ca-qopt:hover small { color: #dbeafe; }
.ca-msg.assistant {
    align-self: flex-start;
    background: #272733;
    border: 1px solid #3a3a4d;
    color: #d1d5db;
}
.ca-msg.system {
    align-self: center;
    background: #2a2a36;
    font-size: 11px;
    color: #9ca3af;
    text-align: center;
    padding: 5px 10px;
}
.ca-msg.loading {
    align-self: flex-start;
    background: #272733;
    border: 1px solid #3a3a4d;
    color: #888;
    font-style: italic;
}
.ca-work-state {
    display: none;
    padding: 5px 10px;
    background: #202838;
    border-top: 1px solid #334155;
    color: #93c5fd;
    font-size: 11px;
}
.ca-queue-item {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #202635;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 5px 7px;
    color: #cbd5e1;
    font-size: 11px;
}
.ca-queue-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-queue-item button { border: 0; background: transparent; color: #94a3b8; cursor: pointer; }
.ca-msg.assistant .ca-markdown { white-space: normal; }
.ca-markdown p { margin: 0 0 8px; }
.ca-markdown p:last-child { margin-bottom: 0; }
.ca-markdown h1, .ca-markdown h2, .ca-markdown h3 {
    margin: 8px 0 5px;
    color: #f1f5f9;
    line-height: 1.25;
}
.ca-markdown h1 { font-size: 17px; }
.ca-markdown h2 { font-size: 15px; }
.ca-markdown h3 { font-size: 14px; }
.ca-markdown ul, .ca-markdown ol { margin: 5px 0 8px 20px; padding: 0; }
.ca-markdown li { margin: 2px 0; }
.ca-markdown blockquote {
    border-left: 3px solid #64748b;
    margin: 7px 0;
    padding: 2px 0 2px 10px;
    color: #b8c1d1;
}
.ca-markdown code {
    background: #15151d;
    border: 1px solid #373746;
    border-radius: 3px;
    padding: 1px 4px;
    color: #c7d2fe;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
}
.ca-markdown pre {
    overflow-x: auto;
    background: #111118;
    border: 1px solid #373746;
    border-radius: 5px;
    padding: 9px;
    margin: 7px 0;
}
.ca-markdown pre code {
    background: transparent;
    border: 0;
    padding: 0;
    color: #dbeafe;
    white-space: pre;
}
.ca-markdown a { color: #93c5fd; text-decoration: underline; }
.ca-markdown .ca-table-wrap { overflow-x: auto; margin: 7px 0; }
.ca-markdown table { border-collapse: collapse; min-width: 100%; font-size: 12px; }
.ca-markdown th, .ca-markdown td {
    border: 1px solid #454557;
    padding: 5px 7px;
    text-align: left;
    vertical-align: top;
}
.ca-markdown th { background: #303044; color: #f1f5f9; }
.ca-markdown tr:nth-child(even) td { background: #20202b; }
.ca-markdown hr { border: 0; border-top: 1px solid #454557; margin: 10px 0; }
.ca-workflow-flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    padding: 10px 4px;
    margin: 8px 0;
    background: #111722;
    border: 1px solid #344054;
    border-radius: 6px;
}
.ca-flow-node {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 5px 9px;
    background: linear-gradient(135deg, #293b5d, #202a43);
    border: 1px solid #5877ad;
    border-radius: 6px;
    color: #dbeafe;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,0,0,.25);
}
.ca-flow-arrow {
    color: #7dd3fc;
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
}
.ca-flow-branch { flex-basis: 100%; height: 0; }
/* Chips bar */
.ca-chips {
    padding: 4px 10px;
    background: #18181e;
    display: flex;
    gap: 5px;
    overflow-x: auto;
    flex-shrink: 0;
    border-top: 1px solid #2a2a36;
}
.ca-chip {
    font-size: 11px;
    background: #2c2c3a;
    padding: 3px 8px;
    border-radius: 10px;
    cursor: pointer;
    color: #a0a0b0;
    white-space: nowrap;
    border: none;
    font-family: inherit;
}
.ca-chip:hover { background: #3c3c4e; color: #fff; }
/* Input area */
.ca-input-area {
    padding: 8px 10px;
    background: #1e1e28;
    border-top: 1px solid #2d2d3a;
    border-radius: 0 0 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
}
.ca-node-preview {
    display: none;
    font-size: 11px;
    background: #252535;
    padding: 4px 8px;
    border-radius: 4px;
    color: #60a5fa;
}
.ca-attachment-list { display: flex; flex-wrap: wrap; gap: 5px; }
.ca-attachment {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #293b5d;
    color: #c7ddff;
    border-radius: 12px;
    padding: 3px 5px 3px 8px;
    font-size: 11px;
}
.ca-attachment-remove {
    border: 0;
    background: transparent;
    color: #a9c5ee;
    cursor: pointer;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
}
.ca-attachment-remove:hover { color: #fff; }
.ca-message-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 7px;
    padding-top: 5px;
    border-top: 1px solid rgba(255,255,255,.16);
}
.ca-message-attachment {
    display: inline-flex;
    align-items: center;
    background: rgba(15,23,42,.55);
    border: 1px solid rgba(191,219,254,.35);
    color: #dbeafe;
    border-radius: 10px;
    padding: 2px 7px;
    font-size: 10px;
}
.ca-drop-active { outline: 2px dashed #60a5fa; outline-offset: -5px; background: #202b40 !important; }
.ca-file-drop-note { font-size: 10px; color: #93c5fd; padding: 2px 0; }
.ca-textarea {
    width: 100%;
    min-height: 44px;
    max-height: 120px;
    background: #141419;
    border: 1px solid #333342;
    border-radius: 6px;
    color: #fff;
    padding: 8px;
    resize: vertical;
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
}
.ca-textarea:focus { outline: none; border-color: #2563eb; }
.ca-command-list {
    display: none;
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 82px;
    background: #22222c;
    border: 1px solid #3a3a4d;
    border-radius: 6px;
    overflow: hidden;
    z-index: 2;
}
.ca-command-item {
    width: 100%;
    display: flex;
    justify-content: space-between;
    border: 0;
    border-bottom: 1px solid #30303e;
    background: transparent;
    color: #ddd;
    padding: 7px 10px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
}
.ca-command-item:last-child { border-bottom: 0; }
.ca-command-item:hover, .ca-command-item.active { background: #30304a; }
.ca-command-item span { color: #8f96a8; font-size: 11px; }
.ca-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.ca-send-btn {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 5px;
    cursor: pointer;
    font-weight: 500;
    font-size: 12px;
    font-family: inherit;
}
.ca-send-btn:hover { background: #1d4ed8; }
.ca-send-btn:disabled { background: #444; cursor: not-allowed; }
/* Modal */
.ca-modal-overlay {
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.65);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100000;
}
.ca-modal {
    background: #1e1e28;
    border: 1px solid #3a3a4d;
    padding: 18px;
    border-radius: 10px;
    width: 400px;
    max-width: 92vw;
    color: #fff;
}
.ca-modal h4 { margin: 0 0 10px 0; font-size: 15px; }
.ca-modal label { display: block; font-size: 12px; margin: 6px 0 2px; color: #aab; }
.ca-modal input {
    width: 100%;
    background: #111118;
    color: #fff;
    border: 1px solid #3a3a4d;
    padding: 6px 8px;
    border-radius: 4px;
    box-sizing: border-box;
    font-size: 13px;
    font-family: inherit;
}
.ca-modal input:focus { outline: none; border-color: #2563eb; }
.ca-modal-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
}
.ca-modal-btn {
    padding: 6px 14px;
    border-radius: 5px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
}
.ca-modal-btn.confirm { background: #16a34a; color: white; }
.ca-modal-btn.confirm:hover { background: #15803d; }
.ca-modal-btn.cancel { background: #4b5563; color: white; }
.ca-modal-btn.cancel:hover { background: #6b7280; }
.ca-modal-btn.danger { background: #dc2626; color: white; }
`;
document.head.appendChild(styleTag);

// ── Helper: escape HTML to prevent XSS ────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function inlineMarkdown(value) {
    const normalized = String(value)
        .replace(/\\longrightarrow/g, "→")
        .replace(/\\rightarrow/g, "→")
        .replace(/\\to\b/g, "→")
        .replace(/\\text\{([^{}]*)\}/g, "$1")
        .replace(/\$\$?/g, "");
    let html = escapeHtml(normalized);
    // Links are only created for safe http(s) URLs.
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    html = html.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
    return html;
}

function parseWorkflowFlow(line) {
    // Recognize the AI's common [Node] ---> [Node] flow syntax.
    line = String(line)
        .replace(/\\longrightarrow/g, "→")
        .replace(/\\rightarrow/g, "→")
        .replace(/\\text\{([^{}]*)\}/g, "$1")
        .replace(/\$\$/g, "");
    if (!/\[[^\]]+\]/.test(line) || !/(?:-{2,}|={2,}|>{1,}|→|➜)/.test(line)) return null;
    const tokens = line.match(/\[[^\]]+\]|(?:-{2,}>|={2,}>|>{1,}|→|➜)/g);
    if (!tokens || tokens.filter(token => token.startsWith("[")).length < 2) return null;
    const flow = document.createElement("div");
    flow.className = "ca-workflow-flow";
    tokens.forEach((token, index) => {
        if (token.startsWith("[")) {
            const node = document.createElement("span");
            node.className = "ca-flow-node";
            node.textContent = token.slice(1, -1).trim();
            flow.appendChild(node);
        } else if (index > 0) {
            const arrow = document.createElement("span");
            arrow.className = "ca-flow-arrow";
            arrow.textContent = "→";
            flow.appendChild(arrow);
        }
    });
    return flow.outerHTML;
}

function renderMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    let paragraph = [];
    let listType = null;
    let code = null;

    const isTableSeparator = (line) =>
        /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    const splitTableRow = (line) => {
        let value = line.trim();
        if (value.startsWith("|")) value = value.slice(1);
        if (value.endsWith("|")) value = value.slice(0, -1);
        return value.split("|").map((cell) => cell.trim());
    };

    const flushParagraph = () => {
        if (paragraph.length) {
            const flowLines = paragraph.map(parseWorkflowFlow);
            if (flowLines.every(Boolean)) {
                output.push(flowLines.join(""));
            } else {
                output.push(`<p>${paragraph.map((line) => inlineMarkdown(line)).join("<br>")}</p>`);
            }
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listType) {
            output.push(`</${listType}>`);
            listType = null;
        }
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
        if (fence) {
            flushParagraph();
            closeList();
            if (code === null) {
                code = [];
            } else {
                const flowLines = code.map(parseWorkflowFlow);
                if (flowLines.length && flowLines.every(Boolean)) {
                    output.push(flowLines.join(""));
                } else {
                    output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
                }
                code = null;
            }
            continue;
        }
        if (code !== null) {
            code.push(line);
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }
        if (/^\s*((---+)|(\*\s*\*\s*\*)|(___+))\s*$/.test(line)) {
            flushParagraph();
            closeList();
            output.push("<hr>");
            continue;
        }
        // GitHub-style table: header row followed immediately by separator row.
        if (line.includes("|") && lines[lineIndex + 1] && isTableSeparator(lines[lineIndex + 1])) {
            flushParagraph();
            closeList();
            const headers = splitTableRow(line);
            const rows = [];
            let rowIndex = lineIndex + 2;
            while (rowIndex < lines.length && lines[rowIndex].includes("|") && lines[rowIndex].trim()) {
                rows.push(splitTableRow(lines[rowIndex]));
                rowIndex++;
            }
            output.push('<div class="ca-table-wrap"><table><thead><tr>');
            headers.forEach((cell) => output.push(`<th>${inlineMarkdown(cell)}</th>`));
            output.push("</tr></thead><tbody>");
            rows.forEach((cells) => {
                output.push("<tr>");
                headers.forEach((_, index) => output.push(`<td>${inlineMarkdown(cells[index] || "")}</td>`));
                output.push("</tr>");
            });
            output.push("</tbody></table></div>");
            // The separator and data rows are consumed by this table block.
            lines.splice(lineIndex + 1, rows.length + 1);
            continue;
        }
        const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length;
            output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }
        const quote = line.match(/^\s*>\s?(.*)$/);
        if (quote) {
            flushParagraph();
            closeList();
            output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
            continue;
        }
        const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
        if (list) {
            flushParagraph();
            const wantedType = /^\d/.test(list[1]) ? "ol" : "ul";
            if (listType !== wantedType) {
                closeList();
                listType = wantedType;
                output.push(`<${listType}>`);
            }
            output.push(`<li>${inlineMarkdown(list[2])}</li>`);
            continue;
        }
        closeList();
        paragraph.push(line);
    }
    if (code !== null) {
        const flowLines = code.map(parseWorkflowFlow);
        output.push(flowLines.length && flowLines.every(Boolean)
            ? flowLines.join("")
            : `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    }
    flushParagraph();
    closeList();
    return output.join("");
}

function cleanProviderMarkers(value) {
    return String(value || "")
        .replace(/<\|[^|>]+\|>/g, "")
        .replace(/\[\s*DSML\s*\]|<\s*\|?DSML\s*\|?>/gi, "")
        .replace(/\bfunction_calls?\b/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// ── Main UI Class ──────────────────────────────────────────────────────────

class ComfyAgentUI {
    constructor() {
        this.panel = null;
        this.messagesEl = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.nodePreviewEl = null;
        this.attachmentListEl = null;
        this.isOpen = false;
        this.isSending = false;
        this.attachments = [];
        this.sessionApprovals = new Set();
        this.yoloMode = false;
        this.sudoRun = false;
        this.skipSessionDeleteApproval = false;
        this.yoloModeLoaded = false;
        this.requestController = null;
        this.messageQueue = [];
        this.lastEscapeAt = 0;
        this.pendingApprovalKeys = new Set();
        this.executedActionKeys = new Set();
        this.approvalQueue = [];
        this.approvalOverlay = null;
        this.activeQuestionKeys = new Set();
        this.agentState = "idle";
        this.workingStartedAt = 0;
        this.workingTimer = null;

        this.initUI();
        this.checkPostRestart();
        this.setupForegroundTrigger();
        // Failsafe: ESC always unlocks input if stuck
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                const now = Date.now();
                if (now - this.lastEscapeAt < 500) this.stopAgent();
                this.lastEscapeAt = now;
                document.querySelectorAll(".ca-modal-overlay").forEach(el => {
                    // Don't close persistent thinking, only modals
                    if (!el.classList.contains("ca-thinking")) el.remove();
                });
            }
        });
    }

    // ── Build DOM ──────────────────────────────────────────────────────────

    initUI() {
        // Toggle button -- try ComfyUI menu first, then top bar, then body
        const toggleBtn = document.createElement("button");
        toggleBtn.id = "comfyagent-launcher";
        toggleBtn.textContent = "AI Chat";
        toggleBtn.title = "Toggle ComfyAgent AI Assistant";
        Object.assign(toggleBtn.style, {
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "8px 12px",
            fontWeight: "bold",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "inherit",
            position: "fixed",
            top: "78px",
            right: "18px",
            zIndex: "100000",
            boxShadow: "0 3px 12px rgba(0,0,0,.4)",
        });
        toggleBtn.onclick = () => this.toggle();
        // The current ComfyUI frontend uses Vue components and does not expose
        // the legacy .comfy-menu selector. A fixed button works across versions.
        document.body.appendChild(toggleBtn);

        // Panel
        this.panel = document.createElement("div");
        this.panel.className = "comfyagent-panel hidden";
        this.panel.innerHTML = `
            <div class="ca-header">
                <h3>ComfyAgent <span class="ca-badge" id="ca-status">Ready</span></h3>
                <div class="ca-controls">
                    <button id="ca-btn-refresh" title="Reload ComfyAgent extension">&#x21bb;</button>
                    <button id="ca-btn-close" title="Close panel">&#x2715;</button>
                </div>
            </div>
            <div class="ca-resize-handle ca-resize-nw" data-resize="nw" title="Resize chat"></div>
            <div class="ca-resize-handle ca-resize-ne" data-resize="ne" title="Resize chat"></div>
            <div class="ca-resize-handle ca-resize-sw" data-resize="sw" title="Resize chat"></div>
            <div class="ca-resize-handle ca-resize-se" data-resize="se" title="Resize chat"></div>
            <div class="ca-messages" id="ca-messages"></div>
            <div class="ca-work-state" id="ca-work-state"></div>
            <div class="ca-chips">
                <button class="ca-chip" data-cmd="/help">/help</button>
                <button class="ca-chip" data-cmd="/model">/model</button>
                <button class="ca-chip" data-cmd="/settings">/settings</button>
                <button class="ca-chip" data-cmd="/session">/session</button>
                <button class="ca-chip" data-cmd="/new">/new</button>
            </div>
            <div class="ca-input-area">
                <div class="ca-node-preview" id="ca-node-preview">
                    <div class="ca-attachment-list" id="ca-attachment-list"></div>
                </div>
                <div class="ca-command-list" id="ca-command-list"></div>
                <textarea class="ca-textarea" id="ca-input" placeholder="Message ComfyAgent or type /command..."></textarea>
                <div class="ca-actions">
                    <button class="ca-chip" id="ca-btn-attach">Attach Selected Node</button>
                    <button class="ca-send-btn" id="ca-btn-send">Send</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.panel);

        // Cache elements
        this.messagesEl = this.panel.querySelector("#ca-messages");
        this.inputEl = this.panel.querySelector("#ca-input");
        this.sendBtn = this.panel.querySelector("#ca-btn-send");
        this.nodePreviewEl = this.panel.querySelector("#ca-node-preview");
        this.attachmentListEl = this.panel.querySelector("#ca-attachment-list");
        this.commandListEl = this.panel.querySelector("#ca-command-list");

        // Listeners
        this.panel.querySelector("#ca-btn-close").onclick = () => this.toggle(false);
        this.sendBtn.onclick = () => this.sendMessage();
        this.panel.querySelector("#ca-btn-attach").onclick = () => this.attachSelectedNode();
        this.setupPanelInteractions();
        this.panel.querySelector("#ca-btn-refresh").onclick = () => this.reloadExtension();

        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                const items = [...this.commandListEl.querySelectorAll("button")];
                if (items.length) {
                    e.preventDefault();
                    const current = items.findIndex((item) => item.classList.contains("active"));
                    const next = e.key === "ArrowDown"
                        ? (current + 1) % items.length
                        : (current - 1 + items.length) % items.length;
                    items.forEach((item) => item.classList.remove("active"));
                    items[next].classList.add("active");
                }
                return;
            }
            if (e.key === "Escape") {
                this.hideCommandSuggestions();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const active = this.commandListEl.querySelector("button.active");
                if (active) {
                    const cmd = active.dataset.command;
                    // @ mentions just fill
                    if (cmd.startsWith("@")) {
                        // Replace last @query with @alias
                        this.inputEl.value = this.inputEl.value.replace(/(?:^|\s)@[\w-]*$/, (prefix) =>
                            `${prefix.startsWith(" ") ? " " : ""}${cmd} `
                        );
                        this.hideCommandSuggestions();
                        this.inputEl.focus();
                        return;
                    }
                    // Slash commands: if user typed exact command, execute immediately
                    const beforeTrim = this.inputEl.value.trim().toLowerCase();
                    const cmdLower = cmd.toLowerCase();
                    const noArgCmds = ["/help", "/settings", "/session", "/new", "/models"];
                    if (beforeTrim === cmdLower) {
                        // Exact typed -> execute directly, no second Enter needed
                        this.inputEl.value = "";
                        this.hideCommandSuggestions();
                        this.handleSlashCommand(cmd);
                        return;
                    }
                    if (noArgCmds.includes(cmdLower)) {
                        // Autocompleted a no-arg command -> execute immediately
                        this.inputEl.value = "";
                        this.hideCommandSuggestions();
                        this.handleSlashCommand(cmd);
                        return;
                    }
                    // For /model and others that need args, fill with space
                    this.inputEl.value = cmd + " ";
                    this.hideCommandSuggestions();
                    this.inputEl.focus();
                    // Place cursor at end
                    this.inputEl.selectionStart = this.inputEl.value.length;
                    return;
                }
                this.sendMessage();
            }
        });
        this.inputEl.addEventListener("input", () => this.updateCommandSuggestions());
        this.inputEl.addEventListener("paste", (event) => this.handleNodePaste(event));
        [this.panel, this.inputEl].forEach(target => {
            target.addEventListener("dragover", event => {
                event.preventDefault();
                this.panel.classList.add("ca-drop-active");
            });
            target.addEventListener("dragleave", event => {
                if (!this.panel.contains(event.relatedTarget)) this.panel.classList.remove("ca-drop-active");
            });
            target.addEventListener("drop", event => this.handleFileDrop(event));
        });

        // Chip listeners
        this.panel.querySelectorAll(".ca-chip[data-cmd]").forEach((chip) => {
            chip.addEventListener("click", () => {
                const cmd = chip.dataset.cmd;
                if (cmd === "/settings") this.openSettingsModal();
                else this.handleSlashCommand(cmd);
            });
        });

        this.loadSession();
        this.loadYoloMode();
    }

    // ── Panel Toggle ───────────────────────────────────────────────────────

    toggle(forceState) {
        this.isOpen = forceState !== undefined ? forceState : !this.isOpen;
        this.panel.classList.toggle("hidden", !this.isOpen);
        const launcher = document.querySelector("#comfyagent-launcher");
        if (launcher) launcher.style.display = this.isOpen ? "none" : "block";
        if (this.isOpen) {
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            this.inputEl.focus();
        }
    }

    setWorking(text) {
        const el = this.panel?.querySelector("#ca-work-state");
        this.currentWorkingText = text;
        if (el) { el.textContent = text; el.style.display = text ? "block" : "none"; }
        if (!text) {
            if (this.workingTimer) clearInterval(this.workingTimer);
            this.workingTimer = null;
            return;
        }
        if (!this.workingStartedAt) this.workingStartedAt = Date.now();
        if (!this.workingTimer) {
            this.workingTimer = setInterval(() => {
                const seconds = Math.floor((Date.now() - this.workingStartedAt) / 1000);
                if (el && el.style.display !== "none") el.textContent = `${this.currentWorkingText} (${seconds}s)`;
            }, 1000);
        }
    }

    setAgentState(state, text) {
        this.agentState = state;
        if (text) this.setWorking(text);
        else if (state === "idle") this.setWorking("");
    }

    shouldHideApprovalText(text, pending) {
        if (!this.yoloMode || !pending || !text) return false;
        return /need your approval|awaiting approval|please approve|approval before|waiting for your approval|i'?ll need your approval/i.test(String(text));
    }

    addAssistantResponse(text, pending) {
        if (!this.shouldHideApprovalText(text, pending)) this.addMsg("assistant", text || "");
    }

    stopAgent() {
        if (this.requestController) this.requestController.abort();
        this.requestController = null;
        this.messageQueue = [];
        this.renderMessageQueue();
        this.isSending = false;
        if (this.sendBtn) this.sendBtn.disabled = false;
        if (this.inputEl) this.inputEl.disabled = false;
        this.messagesEl?.querySelectorAll(".ca-msg.loading").forEach(el => el.remove());
        document.querySelectorAll(".ca-modal-overlay").forEach(el => el.remove());
        this.setWorking("");
        this.agentState = "stopped";
        this.workingStartedAt = 0;
        this.setStatus("Stopped", "#4a2e2e");
        this.addMsg("system", "Agent stopped. No further queued action will run.");
    }

    reloadExtension() {
        // Reload the whole frontend, not just this module. This clears stale
        // Vue/LiteGraph listeners and duplicate extension instances while the
        // backend keeps sessions/settings on disk.
        sessionStorage.setItem("comfyagent_frontend_reload", "true");
        window.location.reload();
    }

    setupPanelInteractions() {
        const header = this.panel.querySelector(".ca-header");
        let drag = null;
        let resize = null;

        header.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) return;
            const rect = this.panel.getBoundingClientRect();
            drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            this.panel.style.left = `${rect.left}px`;
            this.panel.style.top = `${rect.top}px`;
            this.panel.style.right = "auto";
            header.setPointerCapture(event.pointerId);
        });
        header.addEventListener("pointermove", (event) => {
            if (!drag) return;
            const maxLeft = Math.max(0, window.innerWidth - 160);
            const maxTop = Math.max(0, window.innerHeight - 80);
            this.panel.style.left = `${Math.min(maxLeft, Math.max(0, drag.left + event.clientX - drag.x))}px`;
            this.panel.style.top = `${Math.min(maxTop, Math.max(0, drag.top + event.clientY - drag.y))}px`;
        });
        header.addEventListener("pointerup", () => { drag = null; });
        header.addEventListener("pointercancel", () => { drag = null; });

        this.panel.querySelectorAll(".ca-resize-handle").forEach((handle) => {
            handle.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                const rect = this.panel.getBoundingClientRect();
                resize = {
                    corner: handle.dataset.resize,
                    x: event.clientX, y: event.clientY,
                    left: rect.left, top: rect.top,
                    width: rect.width, height: rect.height,
                };
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener("pointermove", (event) => {
                if (!resize) return;
                const dx = event.clientX - resize.x;
                const dy = event.clientY - resize.y;
                const west = resize.corner.includes("w");
                const north = resize.corner.includes("n");
                const width = Math.max(300, resize.width + (west ? -dx : dx));
                const height = Math.max(260, resize.height + (north ? -dy : dy));
                this.panel.style.width = `${Math.min(window.innerWidth - 20, width)}px`;
                this.panel.style.height = `${Math.min(window.innerHeight - 60, height)}px`;
                if (west) this.panel.style.left = `${Math.max(0, resize.left + dx)}px`;
                if (north) this.panel.style.top = `${Math.max(0, resize.top + dy)}px`;
                this.panel.style.right = "auto";
            });
            handle.addEventListener("pointerup", () => { resize = null; });
            handle.addEventListener("pointercancel", () => { resize = null; });
        });
    }

    updateCommandSuggestions() {
        const value = this.inputEl.value;
        if (/(?:^|\s)@[\w-]*$/.test(value)) {
            this.updateMentionSuggestions(value);
            return;
        }
        if (!value.startsWith("/") || value.includes(" ")) {
            this.hideCommandSuggestions();
            return;
        }
        const commands = [
            ["/help", "Show commands and usage"],
            ["/stop", "Stop the active AI request"],
            ["/model", "Show or change the AI model"],
            ["/models", "List all available models"],
            ["/settings", "Open dedicated settings"],
            ["/session", "Open session overview"],
            ["/new", "Create a new session"],
        ].filter(([command]) => command.startsWith(value.toLowerCase()));
        this.commandListEl.innerHTML = "";
        commands.forEach(([command, description], index) => {
            const item = document.createElement("button");
            item.className = `ca-command-item${index === 0 ? " active" : ""}`;
            item.dataset.command = command;
            item.innerHTML = `<b>${command}</b><span>${description}</span>`;
            item.onclick = () => {
                this.inputEl.value = command + " ";
                this.hideCommandSuggestions();
                this.inputEl.focus();
            };
            this.commandListEl.appendChild(item);
        });
        this.commandListEl.style.display = commands.length ? "block" : "none";
    }

    hideCommandSuggestions() {
        this.commandListEl.style.display = "none";
        this.commandListEl.innerHTML = "";
    }

    updateMentionSuggestions(value) {
        const match = value.match(/(?:^|\s)@([\w-]*)$/);
        if (!match || !this.attachments.length) {
            this.hideCommandSuggestions();
            return;
        }
        const query = match[1].toLowerCase();
        const matches = this.attachments.filter((item) => item.alias.toLowerCase().startsWith(query));
        this.commandListEl.innerHTML = "";
        matches.forEach((item, index) => {
            const button = document.createElement("button");
            button.className = `ca-command-item${index === 0 ? " active" : ""}`;
            button.dataset.command = `@${item.alias}`;
            button.innerHTML = `<b>@${item.alias}</b><span>${item.type}</span>`;
            button.onclick = () => {
                this.inputEl.value = this.inputEl.value.replace(/(?:^|\s)@[\w-]*$/, (prefix) =>
                    `${prefix.startsWith(" ") ? " " : ""}@${item.alias} `
                );
                this.hideCommandSuggestions();
                this.inputEl.focus();
            };
            this.commandListEl.appendChild(button);
        });
        this.commandListEl.style.display = matches.length ? "block" : "none";
    }

    // ── Node Attachment ────────────────────────────────────────────────────

    attachSelectedNode() {
        const selected = app.canvas?.selected_nodes ||
            Object.fromEntries((app.graph?._nodes || [])
                .filter((node) => node.selected)
                .map((node) => [node.id, node]));
        if (!selected || Object.keys(selected).length === 0) {
            this.addMsg("system", "No node selected on canvas. Click a node first.");
            return;
        }
        Object.values(selected).forEach((node) => this.addNodeAttachment(node));
        this.renderAttachments();
    }

    addNodeAttachment(node) {
        if (!node || this.attachments.some((item) => item.id === node.id)) return;
        const base = String(node.title || node.type || "node")
            .replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "node";
        let alias = base;
        let suffix = 2;
        while (this.attachments.some((item) => item.alias === alias)) alias = `${base}_${suffix++}`;
        this.attachments.push({
            alias,
            id: node.id,
            type: node.type || "UnknownNode",
            title: node.title || node.type || "Node",
            widgets: node.widgets ? node.widgets.map((w) => ({ name: w.name, value: w.value })) :
                (node.widgets_values || []).map((value, index) => ({ name: `widget_${index}`, value })),
        });
    }

    removeAttachment(id) {
        this.attachments = this.attachments.filter((item) => item.id !== id);
        this.renderAttachments();
    }

    renderAttachments() {
        this.attachmentListEl.innerHTML = "";
        this.attachments.forEach((item) => {
            const chip = document.createElement("span");
            chip.className = "ca-attachment";
            chip.title = `${item.type} #${item.id}`;
            chip.appendChild(document.createTextNode(`@${item.alias}`));
            const remove = document.createElement("button");
            remove.className = "ca-attachment-remove";
            remove.type = "button";
            remove.textContent = "×";
            remove.title = "Remove attachment";
            remove.onclick = () => this.removeAttachment(item.id);
            chip.appendChild(remove);
            this.attachmentListEl.appendChild(chip);
        });
        this.nodePreviewEl.style.display = this.attachments.length ? "block" : "none";
    }

    handleNodePaste(event) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return;
        let payload;
        try { payload = JSON.parse(text); } catch { return; }
        const nodes = Array.isArray(payload) ? payload :
            Array.isArray(payload.nodes) ? payload.nodes :
            (payload.type || payload.class_type ? [payload] : []);
        const nodePayloads = nodes.filter((node) => node && (node.type || node.class_type));
        if (!nodePayloads.length) return; // ordinary JSON/text paste remains untouched
        nodePayloads.forEach((node) => this.addNodeAttachment({
            id: node.id ?? `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: node.type || node.class_type,
            title: node.title || node.type || node.class_type,
            widgets: node.widgets || (node.widgets_values || []).map((value, index) => ({ name: `widget_${index}`, value })),
        }));
        this.renderAttachments();
        this.addMsg("system", `${nodePayloads.length} pasted node${nodePayloads.length === 1 ? "" : "s"} attached. Normal text paste is unchanged.`);
    }

    async handleFileDrop(event) {
        event.preventDefault();
        this.panel.classList.remove("ca-drop-active");
        const items = [...(event.dataTransfer?.items || [])];
        const files = [...(event.dataTransfer?.files || [])];
        const dropped = [];
        const addFile = (file, relativePath) => {
            if (!file) return;
            dropped.push({
                id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                alias: file.name.replace(/[^\w-]+/g, "_") || "file",
                type: "file",
                title: file.name,
                path: relativePath || file.webkitRelativePath || file.name,
                size: file.size,
                mime: file.type || "application/octet-stream",
            });
        };
        const readEntry = (entry, parent = "") => new Promise(resolve => {
            if (entry.isFile) {
                entry.file(file => { addFile(file, `${parent}${file.name}`); resolve(); }, () => resolve());
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                const readBatch = () => reader.readEntries(async entries => {
                    if (!entries.length) return resolve();
                    for (const child of entries) await readEntry(child, `${parent}${entry.name}/`);
                    readBatch();
                }, () => resolve());
                readBatch();
            } else resolve();
        });
        for (const item of items) {
            const entry = item.webkitGetAsEntry?.();
            if (entry) await readEntry(entry);
        }
        if (!dropped.length) files.forEach(file => addFile(file));
        if (!dropped.length) return;
        // File contents are not uploaded automatically. The AI receives safe
        // path/name metadata; explicit file reading can be added later with
        // user approval and size/type limits.
        dropped.forEach(file => this.attachments.push(file));
        this.renderAttachments();
        this.addMsg("system", `${dropped.length} file/folder item${dropped.length === 1 ? "" : "s"} attached. Only names, paths, sizes, and MIME types are sent until file reading is approved.`);
    }

    // ── Session Loading ────────────────────────────────────────────────────

    async loadSession() {
        try {
            const data = await this.apiJson("/comfyagent/sessions");
            this.renderMessages(data.active?.messages || []);
            // Always restore input after reload (fixes stuck isSending after revert)
            this.isSending = false;
            if (this.sendBtn) this.sendBtn.disabled = false;
            if (this.inputEl) this.inputEl.disabled = false;
            this.setStatus("Ready", "#2e4a2e");
            // Clean stray modals that could block typing
            document.querySelectorAll(".ca-modal-overlay").forEach(el => {
                // Keep approval modals that are pending? No, revert should close them
                if (el.dataset.persistent !== "true") el.remove();
            });
        } catch (e) {
            this.addMsg("system", `Failed to load session: ${e.message}`);
            this.isSending = false;
            if (this.sendBtn) this.sendBtn.disabled = false;
        }
    }

    async loadYoloMode() {
        try {
            const settings = await this.apiJson("/comfyagent/settings");
            this.yoloMode = settings.yolo_mode === true;
            this.sudoRun = settings.sudo_run === true;
            this.skipSessionDeleteApproval = settings.skip_session_delete_approval === true;
        } catch { this.yoloMode = false; }
        finally { this.yoloModeLoaded = true; }
    }

    async apiJson(url, options) {
        const resp = await fetch(url, options);
        const text = await resp.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(`ComfyUI returned HTTP ${resp.status} instead of JSON`);
        }
        if (!resp.ok) {
            const detail = data.error || data.message || (text && text.slice(0, 1000));
            throw new Error(`HTTP ${resp.status}${detail ? `: ${detail}` : ""}`);
        }
        return data;
    }

    renderMessages(messages) {
        // Keep for revert fallback (old sessions without ids)
        this._lastMessages = messages;
        this.messagesEl.innerHTML = "";
        let pendingCalls = null;
        let pendingResults = [];
        const flushThinking = () => {
            if (pendingCalls) {
                const el = this._createThinkingFromHistory(pendingCalls, pendingResults);
                this.messagesEl.appendChild(el);
                pendingCalls = null;
                pendingResults = [];
            }
        };
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (m.role === "system") continue;
            if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
                if (m.content && m.content.trim()) this.addMsg("assistant", m.content, m.id, i);
                pendingCalls = m.tool_calls;
                pendingResults = [];
                continue;
            }
            if (m.role === "assistant" && m.tool_trace && m.tool_trace.length) {
                this.messagesEl.appendChild(this._createThinkingFromTrace(m.tool_trace));
            }
            if (m.role === "tool") {
                pendingResults.push(m);
                const next = messages[i+1];
                if (!next || next.role !== "tool") flushThinking();
                continue;
            }
            flushThinking();
            if (m.role === "assistant" || m.role === "user") {
                this.addMsg(m.role, m.content || "", m.id, i, m.attachments);
            }
        }
        flushThinking();
    }

    _createThinkingFromHistory(toolCalls, toolResults) {
        const trace = toolCalls.map((tc, idx) => {
            const res = toolResults[idx];
            let output = res ? (res.content || "") : "";
            try { const parsed = JSON.parse(output); if (parsed.status === "pending_user_approval") output = JSON.stringify(parsed, null, 2); } catch {}
            return {
                tool: tc.function?.name || tc.function?.name || "unknown",
                args: tc.function?.arguments ? (()=>{ try{return JSON.parse(tc.function.arguments)}catch{return tc.function.arguments}})() : {},
                output: output.slice(0, 800),
                pending: output.includes("pending_user_approval")
            };
        });
        return this._createThinkingElement(trace);
    }

    _createThinkingFromTrace(trace) {
        // trace from backend tool_trace: [{tool, args, output, pending}]
        return this._createThinkingElement(trace);
    }

    _createThinkingElement(trace) {
        const details = document.createElement("details");
        details.className = "ca-thinking";
        details.open = false;
        const summary = document.createElement("summary");
        const icon = document.createElement("span");
        icon.textContent = "▸";
        icon.style.transition = "transform 0.15s";
        icon.style.fontSize = "10px";
        summary.appendChild(icon);
        const label = document.createElement("span");
        label.textContent = `Thinking · ${trace.length} tool${trace.length!==1?"s":""}`;
        summary.appendChild(label);
        const badges = document.createElement("span");
        badges.className = "ca-thinking-badges";
        trace.forEach(t => {
            const b = document.createElement("span");
            b.className = "ca-badge-tool " + (t.pending ? "pending" : "done");
            b.textContent = t.tool;
            badges.appendChild(b);
        });
        summary.appendChild(badges);
        details.appendChild(summary);
        details.addEventListener("toggle", () => { icon.textContent = details.open ? "▾" : "▸"; });
        const body = document.createElement("div");
        body.className = "ca-thinking-body";
        trace.forEach(t => {
            const row = document.createElement("div");
            row.className = "ca-tool-row";
            const head = document.createElement("div");
            head.innerHTML = `<b>tool: ${t.tool}</b> ${t.pending ? "<span style='color:#fcd34d;font-size:10px;'>· awaiting approval</span>" : ""}`;
            row.appendChild(head);
            if (t.args && Object.keys(t.args).length) {
                const argsPre = document.createElement("pre");
                argsPre.textContent = JSON.stringify(t.args, null, 2).slice(0, 600);
                argsPre.style.background = "#1a2233";
                argsPre.style.marginBottom = "4px";
                row.appendChild(argsPre);
            }
            if (t.output) {
                const outPre = document.createElement("pre");
                outPre.textContent = t.output.slice(0, 800);
                row.appendChild(outPre);
            }
            body.appendChild(row);
        });
        details.appendChild(body);
        return details;
    }

    _refreshThinkingElement(details, trace) {
        if (!details || !trace) return;
        const fresh = this._createThinkingElement(trace);
        const currentSummary = details.querySelector("summary");
        const freshSummary = fresh.querySelector("summary");
        const currentBody = details.querySelector(".ca-thinking-body");
        const freshBody = fresh.querySelector(".ca-thinking-body");
        if (currentSummary && freshSummary) {
            const currentLabel = currentSummary.querySelector("span:nth-child(2)");
            const freshLabel = freshSummary.querySelector("span:nth-child(2)");
            const currentBadges = currentSummary.querySelector(".ca-thinking-badges");
            const freshBadges = freshSummary.querySelector(".ca-thinking-badges");
            if (currentLabel && freshLabel) currentLabel.textContent = freshLabel.textContent;
            if (currentBadges && freshBadges) currentBadges.innerHTML = freshBadges.innerHTML;
        }
        if (currentBody && freshBody) {
            const scrollTop = currentBody.scrollTop;
            currentBody.innerHTML = freshBody.innerHTML;
            currentBody.scrollTop = scrollTop;
        }
    }

    addMsg(role, text, msgId, msgIdx, attachments) {
        const div = document.createElement("div");
        div.className = `ca-msg ${role}`;
        if (msgId) div.dataset.msgId = msgId;
        if (msgIdx !== undefined) div.dataset.msgIdx = String(msgIdx);
        if (role === "assistant") {
            const content = document.createElement("div");
            content.className = "ca-markdown";
            content.innerHTML = renderMarkdown(cleanProviderMarkers(text) || "_(No text was returned by the model.)_");
            div.appendChild(content);
        } else {
            div.textContent = text;
        }
        if (role === "user" && Array.isArray(attachments) && attachments.length) {
            const attachmentRow = document.createElement("div");
            attachmentRow.className = "ca-message-attachments";
            attachments.forEach((item) => {
                const badge = document.createElement("span");
                badge.className = "ca-message-attachment";
                badge.textContent = `@${item.alias || item.title || item.type || "node"}`;
                badge.title = `${item.type || "Node"} #${item.id ?? "?"}`;
                attachmentRow.appendChild(badge);
            });
            div.appendChild(attachmentRow);
        }
        // Revert button — only chat history, does NOT delete canvas nodes
        if (role === "user") {
            const rev = document.createElement("button");
            rev.className = "ca-revert";
            rev.textContent = "↩ revert";
            rev.title = "Revert chat history to before this message (nodes stay, input is restored)";
            rev.onclick = async (e) => {
                e.stopPropagation();
                const targetId = msgId || div.dataset.msgId;
                const targetIdx = msgIdx !== undefined ? msgIdx : (div.dataset.msgIdx ? parseInt(div.dataset.msgIdx) : null);
                try {
                    this.isSending = false;
                    if (this.sendBtn) this.sendBtn.disabled = false;
                    if (this.inputEl) this.inputEl.disabled = false;
                    this.setStatus("Ready", "#2e4a2e");
                    this.messagesEl.querySelectorAll(".ca-msg.loading").forEach(el => el.remove());
                    // Remove any blocking overlays
                    document.querySelectorAll(".ca-modal-overlay").forEach(el => el.remove());
                    let done = false;
                    if (targetId && targetId !== "undefined") {
                        try {
                            await this.apiJson("/comfyagent/sessions/revert", {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify({msg_id: targetId})
                            });
                            done = true;
                        } catch (err) {
                            // Fallback for old sessions without ids: use index-based count
                            if (targetIdx !== null && this._lastMessages) {
                                const count = this._lastMessages.length - targetIdx;
                                if (count > 0) {
                                    await this.apiJson("/comfyagent/sessions/revert", {
                                        method: "POST",
                                        headers: {"Content-Type": "application/json"},
                                        body: JSON.stringify({count})
                                    });
                                    done = true;
                                }
                            }
                            if (!done) throw err;
                        }
                    } else if (targetIdx !== null && this._lastMessages) {
                        const count = this._lastMessages.length - targetIdx;
                        await this.apiJson("/comfyagent/sessions/revert", {
                            method: "POST",
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({count: count > 0 ? count : 2})
                        });
                        done = true;
                    } else {
                        await this.apiJson("/comfyagent/sessions/revert", {
                            method: "POST",
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({count: 2})
                        });
                        done = true;
                    }
                    if (done) {
                        await this.loadSession();
                        this.addMsg("system", "Reverted chat history — you can chat again.");
                        this.inputEl.focus();
                    }
                    this.isSending = false;
                    if (this.sendBtn) this.sendBtn.disabled = false;
                    if (this.inputEl) this.inputEl.disabled = false;
                } catch (err) {
                    this.isSending = false;
                    if (this.sendBtn) this.sendBtn.disabled = false;
                    if (this.inputEl) this.inputEl.disabled = false;
                    this.addMsg("system", "Revert failed: " + err.message);
                    this.inputEl.focus();
                }
            };
            div.appendChild(rev);
        }
        this.messagesEl.appendChild(div);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        return div;
    }

    removeMsg(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    setStatus(text, color) {
        const badge = this.panel.querySelector("#ca-status");
        badge.textContent = text;
        badge.style.background = color || "#2e4a2e";
    }

    // ── Slash Commands ─────────────────────────────────────────────────────

    async handleSlashCommand(text) {
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
            case "/stop":
                this.stopAgent();
                break;
            case "/help":
                this.addMsg(
                    "system",
                    "ComfyAgent Commands:\n" +
                    "  /help         Show this help\n" +
                    "  /model        Show current model, or /model <id> to switch\n" +
                    "  /settings     Open settings dialog (API keys, endpoint, model)\n" +
                    "  /session      List all sessions\n" +
                    "  /new          Start a new chat session\n\n" +
                    "Tips:\n" +
                    "  - Click 'Attach Selected Node' to send node context to AI\n" +
                    "  - The AI can search for custom nodes, install them, inspect your canvas,\n" +
                    "    and trigger test runs -- always with your approval first."
                );
                break;

            case "/model":
                if (parts[1]) {
                    await this.apiJson("/comfyagent/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model_id: parts.slice(1).join(" ") }),
                    });
                    this.addMsg("system", `Model switched to: ${parts.slice(1).join(" ")}`);
                } else {
                    try {
                        const data = await this.apiJson("/comfyagent/models");
                        const all = data.all_models || [];
                        const list = all.slice(0, 20).map(m => `  ${m.id}${m.id === data.current_model ? "  (current)" : ""}`).join("\n");
                        const extra = all.length > 20 ? `\n  ... and ${all.length - 20} more` : "";
                        this.addMsg(
                            "system",
                            `Current: ${data.current_model}\nEndpoint: ${data.endpoint}\nRecommended free: ${data.recommended_free}\n\nAvailable models (${data.models_count}):\n${list}${extra}\n\nUse /model <model_id> to switch. Example: /model ${all[0]?.id || "auto"}`
                        );
                    } catch (e) {
                        this.addMsg("system", `Failed to fetch model info: ${e.message}`);
                    }
                }
                break;
            case "/models":
                // Alias for /model
                await this.handleSlashCommand("/model" + (parts[1] ? " " + parts.slice(1).join(" ") : ""));
                break;

            case "/settings":
                this.openSettingsModal();
                break;

            case "/session":
                this.openSessionOverview();
                break;

            case "/new":
                try {
                    await this.apiJson("/comfyagent/sessions/new", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({}),
                    });
                    this.addMsg("system", "New session started.");
                    await this.loadSession();
                } catch {
                    this.addMsg("system", "Failed to create new session.");
                }
                break;

            default:
                this.addMsg("system", `Unknown command: ${cmd}. Type /help for a list.`);
        }
    }

    async openSessionOverview() {
        let data;
        try {
            data = await this.apiJson("/comfyagent/sessions");
        } catch (e) {
            this.addMsg("system", `Failed to fetch sessions: ${e.message}`);
            return;
        }

        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";
        const modal = document.createElement("div");
        modal.className = "ca-modal";
        const title = document.createElement("h4");
        title.textContent = "Chat Sessions";
        modal.appendChild(title);
        const activeSessionId = data.active?.id;

        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:45vh;overflow:auto;";
        for (const session of data.sessions || []) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;gap:4px;align-items:center;";
            const button = document.createElement("button");
            button.className = "ca-modal-btn";
            button.style.cssText = "flex:1;text-align:left;background:#2b2b38;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            button.textContent = `${session.active ? "Active: " : ""}${session.name} (${session.msg_count} messages)`;
            button.onclick = async () => {
                try {
                    if (session.id === activeSessionId) return;
                    // Session switch is a hard UI context boundary.
                    this.stopAgent();
                    this.approvalQueue = [];
                    this.pendingApprovalKeys.clear();
                    this.executedActionKeys.clear();
                    this.activeQuestionKeys.clear();
                    await this.apiJson("/comfyagent/sessions/switch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ session_id: session.id }),
                    });
                    overlay.remove();
                    await this.loadSession();
                    this.setAgentState("idle");
                    this.addMsg("system", `Switched to session: ${session.name}`);
                } catch (e) {
                    this.addMsg("system", `Could not switch session: ${e.message}`);
                }
            };
            row.appendChild(button);
            // Export
            const exportBtn = document.createElement("button");
            exportBtn.className = "ca-modal-btn cancel";
            exportBtn.style.cssText = "padding:6px 8px;font-size:11px;";
            exportBtn.textContent = "⤓";
            exportBtn.title = "Export session as JSON";
            exportBtn.onclick = async () => {
                try {
                    const exp = await this.apiJson(`/comfyagent/sessions/export/${session.id}`);
                    const blob = new Blob([JSON.stringify(exp, null, 2)], {type:"application/json"});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `comfyagent-session-${session.id}.json`; a.click();
                    URL.revokeObjectURL(url);
                    this.addMsg("system", `Exported ${session.name}`);
                } catch (e) { this.addMsg("system", "Export failed: " + e.message); }
            };
            row.appendChild(exportBtn);
            // Delete
            const delBtn = document.createElement("button");
            delBtn.className = "ca-modal-btn danger";
            delBtn.style.cssText = "padding:6px 8px;font-size:11px;";
            delBtn.textContent = "✕";
            delBtn.title = "Delete session";
            delBtn.onclick = async () => {
                const deleteSession = async () => {
                    try {
                        await this.apiJson("/comfyagent/sessions/delete", {
                            method: "POST", headers: {"Content-Type":"application/json"},
                            body: JSON.stringify({session_id: session.id})
                        });
                        row.remove();
                        // Keep this overview open when deleting an inactive
                        // session. loadSession() removes modal overlays, so it
                        // must only run when the active session changed.
                        if (session.id === activeSessionId) {
                            overlay.remove();
                            this.addMsg("system", `Deleted active session ${session.name}`);
                            await this.loadSession();
                        } else {
                            this.addMsg("system", `Deleted session ${session.name}`);
                        }
                    } catch (e) { this.addMsg("system", "Delete failed: " + e.message); }
                };
                if (this.skipSessionDeleteApproval) {
                    await deleteSession();
                    return;
                }
                this._showConfirmModal(
                    "Delete session?",
                    `Delete session "${session.name}"? This only deletes chat history; workflow nodes are not affected.`,
                    deleteSession,
                    () => this.addMsg("system", "Session deletion cancelled.")
                );
            };
            row.appendChild(delBtn);
            list.appendChild(row);
        }
        modal.appendChild(list);

        const btns = document.createElement("div");
        btns.className = "ca-modal-btns";
        const close = document.createElement("button");
        close.className = "ca-modal-btn cancel";
        close.textContent = "Close";
        close.onclick = () => overlay.remove();
        btns.appendChild(close);
        modal.appendChild(btns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e)=>{ if(e.target===overlay) overlay.remove(); });
    }

    // ── Send Message ───────────────────────────────────────────────────────

    async sendMessage() {
        const text = this.inputEl.value.trim();
        if ((!text && !this.attachments.length)) return;
        if (this.isSending) {
            this.messageQueue.push({text, attachments: this.attachments.map(item => ({...item}))});
            this.inputEl.value = "";
            this.attachments = [];
            this.renderAttachments();
            this.renderMessageQueue();
            return;
        }

        // Slash command?
        if (text.startsWith("/")) {
            this.inputEl.value = "";
            this.hideCommandSuggestions();
            await this.handleSlashCommand(text);
            return;
        }

        let fullPrompt = text;
        const visiblePrompt = text;
        const sentAttachments = this.attachments.map(item => ({...item}));
        if (this.attachments.length) {
            fullPrompt += "\n[ATTACHED NODES - aliases are UI-only references]:\n" +
                this.attachments.map((item) =>
                    `${item.alias} -> Type=${item.type}, ID=${item.id}, Title=${item.title}, Params=${JSON.stringify(item.widgets)}`
                ).join("\n");
            this.attachments = [];
            this.renderAttachments();
            this.nodePreviewEl.style.display = "none";
        }

        // Show only the user's message. Technical attachment metadata is sent
        // to the model but must not pollute the visible chat bubble.
        this.addMsg("user", visiblePrompt, undefined, undefined, sentAttachments);
        this.inputEl.value = "";
        this.isSending = true;
        this.requestController = new AbortController();
        this.sendBtn.disabled = true;
        this.setStatus("Thinking...", "#3a3a2e");
        this.setAgentState("working", "Working: sending request to AI…");
        const loadingEl = this.addMsg("loading", "...");

        // Build canvas context
        const canvasContext = this._getCanvasContext();

        // Try live streaming first (for thinking + tokens), fallback to non-stream
        let streamed = false;
        try {
            const streamResp = await fetch("/comfyagent/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: fullPrompt, canvas_context: canvasContext, attachments: sentAttachments }),
                signal: this.requestController.signal,
            });
            const ctype = streamResp.headers.get("content-type") || "";
            if (streamResp.ok && ctype.includes("text/event-stream") && streamResp.body) {
                streamed = true;
                this.removeMsg(loadingEl);
                // Live thinking dropdown (created on first tool/thinking token)
                let thinkingTrace = [];
                let thinkingEl = null;
                let thinkingRefreshQueued = false;
                // Create the assistant bubble before callbacks can receive the
                // first streamed event.
                let assistantDiv = document.createElement("div");
                assistantDiv.className = "ca-msg assistant";
                let mdDiv = document.createElement("div");
                mdDiv.className = "ca-markdown";
                mdDiv.textContent = "…";
                assistantDiv.appendChild(mdDiv);
                this.messagesEl.appendChild(assistantDiv);
                const ensureThinking = () => {
                    if (thinkingRefreshQueued) return;
                    thinkingRefreshQueued = true;
                    requestAnimationFrame(() => {
                        thinkingRefreshQueued = false;
                    if (!thinkingEl) {
                        thinkingEl = this._createThinkingFromTrace(thinkingTrace);
                        // Insert before the streaming assistant bubble
                        this.messagesEl.insertBefore(thinkingEl, assistantDiv);
                    } else {
                        this._refreshThinkingElement(thinkingEl, thinkingTrace);
                    }
                    });
                };
                // Streaming assistant bubble (live markdown at end)
                let accText = "";
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

                const reader = streamResp.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                let pendingApprovals = null;
                let toolTraceFinal = null;
                let hasError = false;
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, {stream:true});
                    let parts = buf.split("\n\n");
                    buf = parts.pop();
                    for (const part of parts) {
                        const lines = part.split("\n");
                        for (let line of lines) {
                            line = line.trim();
                            if (!line.startsWith("data:")) continue;
                            const payload = line.slice(5).trim();
                            if (!payload || payload === "[DONE]") continue;
                            let evt;
                            try { evt = JSON.parse(payload); } catch { continue; }
                            if (evt.type === "token") {
                                accText += evt.text || "";
                                mdDiv.textContent = cleanProviderMarkers(accText) || "…";
                                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
                            } else if (evt.type === "thinking") {
                                this.setAgentState("working", "Working: AI reasoning…");
                                // Append thinking token to trace as a pseudo tool
                                if (!thinkingTrace.length || thinkingTrace[thinkingTrace.length-1].tool !== "thinking") {
                                    thinkingTrace.push({tool: "thinking", args: {}, output: evt.text || "", pending: false});
                                } else {
                                    thinkingTrace[thinkingTrace.length-1].output += evt.text || "";
                                }
                                ensureThinking();
                            } else if (evt.type === "tool") {
                                this.setAgentState("working", `Working: calling ${evt.tool || "tool"}…`);
                                thinkingTrace.push({tool: evt.tool, args: {}, output: "", pending: true});
                                ensureThinking();
                            } else if (evt.type === "tool_result") {
                                this.setAgentState("working", `Working: received ${evt.tool || "tool"} result…`);
                                // Find last pending for this tool and fill output
                                for (let i = thinkingTrace.length-1; i >=0; i--) {
                                    if (thinkingTrace[i].tool === evt.tool && thinkingTrace[i].pending) {
                                        thinkingTrace[i].output = (evt.output || "").slice(0,800);
                                        thinkingTrace[i].pending = false;
                                        break;
                                    }
                                }
                                ensureThinking();
                            } else if (evt.type === "pending") {
                                this.setAgentState("waiting_approval", "Waiting: processing approval/question…");
                                pendingApprovals = evt.pending_approvals || (evt.pending_approval ? [evt.pending_approval] : []);
                                toolTraceFinal = evt.tool_trace || thinkingTrace;
                                if (toolTraceFinal && toolTraceFinal.length) {
                                    thinkingTrace = toolTraceFinal;
                                    ensureThinking();
                                }
                                this.queuePendingApprovals(pendingApprovals);
                            } else if (evt.type === "done") {
                                this.setAgentState("working", "Finishing response…");
                                accText = cleanProviderMarkers(evt.response || accText);
                                toolTraceFinal = evt.tool_trace || thinkingTrace;
                                pendingApprovals = evt.pending_approvals || pendingApprovals;
                                if (!pendingApprovals && evt.pending_approval) pendingApprovals = [evt.pending_approval];
                            } else if (evt.type === "error") {
                                hasError = true;
                                mdDiv.textContent = `[Error]: ${evt.error}`;
                            }
                        }
                    }
                }
                // Finalize
                if (!hasError) {
                    if (accText) {
                        mdDiv.innerHTML = "";
                        const finalMd = document.createElement("div");
                        finalMd.className = "ca-markdown";
                        const finalText = this.shouldHideApprovalText(accText, pendingApprovals)
                            ? ""
                            : cleanProviderMarkers(accText);
                        finalMd.innerHTML = renderMarkdown(finalText);
                        assistantDiv.innerHTML = "";
                        if (finalText) assistantDiv.appendChild(finalMd);
                        // Add revert button
                        const rev = document.createElement("button");
                        rev.className = "ca-revert";
                        rev.textContent = "↩ revert";
                        rev.title = "Revert chat history to before this message";
                        rev.onclick = async (e) => {
                            e.stopPropagation();
                            try {
                                this.isSending = false; if(this.sendBtn) this.sendBtn.disabled=false;
                                await this.apiJson("/comfyagent/sessions/revert", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({count: 2})});
                                await this.loadSession();
                                this.addMsg("system","Reverted.");
                                this.inputEl.focus();
                            } catch(err){ this.addMsg("system","Revert failed: "+err.message); }
                        };
                        if (finalText) assistantDiv.appendChild(rev);
                        assistantDiv.dataset.streamed = "true";
                    } else {
                        assistantDiv.remove();
                    }
                    // Ensure thinking shown even if only done event had it
                    if (toolTraceFinal && toolTraceFinal.length && !thinkingEl) {
                        const el = this._createThinkingFromTrace(toolTraceFinal);
                        this.messagesEl.insertBefore(el, assistantDiv);
                    }
                    if (pendingApprovals && pendingApprovals.length) {
                        this.queuePendingApprovals(pendingApprovals);
                    } else if (toolTraceFinal && toolTraceFinal.length && pendingApprovals === null) {
                        // No pending, just show thinking was done
                    }
                    // Persist final assistant to session already done server-side, but ensure scroll
                    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
                }
            } else {
                // Not SSE — fallback to JSON
                const text = await streamResp.text();
                let data;
                try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${streamResp.status}: ${text.slice(0,500)}`); }
                if (!streamResp.ok) throw new Error(data.error || `HTTP ${streamResp.status}`);
                this.removeMsg(loadingEl);
                if (data.error) this.addMsg("assistant", `[Error]: ${data.error}`);
                else {
                    if (data.tool_trace && data.tool_trace.length) {
                        const thinkingEl = this._createThinkingFromTrace(data.tool_trace);
                        this.messagesEl.appendChild(thinkingEl);
                    }
                    this.addAssistantResponse(data.response, data.pending_approval || data.pending_approvals);
                    if (data.pending_approvals) this.queuePendingApprovals(data.pending_approvals);
                    else if (data.pending_approval) this.queuePendingApprovals([data.pending_approval]);
                }
            }
        } catch (e) {
            if (e.name === "AbortError") {
                this.addMsg("system", "Active AI request stopped.");
                return;
            }
            // Network or parse error — fallback to non-stream endpoint
            if (!streamed) {
                try { this.removeMsg(loadingEl); } catch {}
                // If streamed already handled, don't double-show error
                if (String(e.message).includes("Failed to fetch") || String(e.message).includes("HTTP")) {
                    // Try one more time with non-stream
                    try {
                        const data = await this.apiJson("/comfyagent/chat", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ message: fullPrompt, canvas_context: canvasContext, attachments: sentAttachments }),
                        });
                        if (data.error) this.addMsg("assistant", `[Error]: ${data.error}`);
                        else {
                            if (data.tool_trace && data.tool_trace.length) {
                                const thinkingEl = this._createThinkingFromTrace(data.tool_trace);
                                this.messagesEl.appendChild(thinkingEl);
                            }
                            this.addAssistantResponse(data.response, data.pending_approval || data.pending_approvals);
                            if (data.pending_approvals) this.queuePendingApprovals(data.pending_approvals);
                            else if (data.pending_approval) this.queuePendingApprovals([data.pending_approval]);
                        }
                    } catch (e2) {
                        this.addMsg("assistant", `[Connection Error]: ${e2.message}`);
                    }
                } else {
                    this.addMsg("assistant", `[Connection Error]: ${e.message}`);
                }
            } else {
                try { this.removeMsg(loadingEl); } catch {}
                this.addMsg("assistant", `[Stream Error]: ${e.message}`);
            }
        } finally {
            this.isSending = false;
            this.requestController = null;
            this.sendBtn.disabled = false;
            if (this.agentState === "working" || this.agentState === "stopped") this.setAgentState("idle");
            this.setStatus("Ready", "#2e4a2e");
            this.processNextQueuedMessage();
        }
    }

    renderMessageQueue() {
        const state = this.panel?.querySelector("#ca-work-state");
        if (!state) return;
        state.innerHTML = "";
        if (!this.messageQueue.length) { state.style.display = "none"; return; }
        state.style.display = "block";
        state.textContent = "Queued messages:";
        this.messageQueue.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "ca-queue-item";
            const label = document.createElement("span");
            label.textContent = item.text || "(attached items)";
            row.appendChild(label);
            const edit = document.createElement("button");
            edit.textContent = "edit";
            edit.title = "Edit queued message";
            edit.onclick = () => {
                this.inputEl.value = item.text;
                this.attachments = item.attachments || [];
                this.renderAttachments();
                this.messageQueue.splice(index, 1);
                this.renderMessageQueue();
                this.inputEl.focus();
            };
            const remove = document.createElement("button");
            remove.textContent = "×";
            remove.title = "Remove queued message";
            remove.onclick = () => { this.messageQueue.splice(index, 1); this.renderMessageQueue(); };
            row.append(edit, remove);
            state.appendChild(row);
        });
    }

    async processNextQueuedMessage() {
        if (this.isSending || !this.messageQueue.length) return;
        const next = this.messageQueue.shift();
        this.renderMessageQueue();
        this.inputEl.value = next.text;
        this.attachments = next.attachments || [];
        this.renderAttachments();
        await this.sendMessage();
    }

    _getCanvasContext() {
        try {
            const graph = app.graph;
            const nodes = graph?._nodes || [];
            const links = [];
            // Links are stored in graph.links (object map) or ._links
            const linkSource = graph?.links || graph?._links || {};
            for (const [id, link] of Object.entries(linkSource)) {
                if (!link) continue;
                // LiteGraph link: [id, origin_id, origin_slot, target_id, target_slot, type]
                if (Array.isArray(link)) {
                    links.push({ id, origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4], type: link[5] });
                } else if (typeof link === "object") {
                    links.push({ id: link.id || id, origin_id: link.origin_id, origin_slot: link.origin_slot, target_id: link.target_id, target_slot: link.target_slot, type: link.type });
                }
                if (links.length >= 80) break;
            }
            const groups = (graph?._groups || graph?.groups || []).map(g => ({
                id: g.id, title: g.title, bounding: g._bounding || g.bounding
            }));
            const serializeNested = (value, depth = 0) => {
                if (depth > 5 || value === null || value === undefined) return undefined;
                if (Array.isArray(value)) return value.slice(0, 100).map(v => serializeNested(v, depth + 1));
                if (typeof value !== "object") return typeof value === "function" ? undefined : value;
                const out = {};
                for (const key of ["id", "type", "title", "nodes", "links", "groups", "inputs", "outputs", "subgraph", "graph", "workflow", "children"]) {
                    if (value[key] !== undefined && typeof value[key] !== "function") out[key] = serializeNested(value[key], depth + 1);
                }
                return out;
            };
            const subgraphs = nodes.filter(n => n.type && n.type.toLowerCase().includes("subgraph") || n.subgraph || n.graph || n.workflow).map(n => ({
                id: n.id, type: n.type, title: n.title,
                nested_graph: serializeNested(n.subgraph || n.graph || n.workflow || n.children),
                owner_id: n.id
            }));
            // Also detect ComfyUI's subgraph nodes via flags
            const subgraphNodes = nodes.filter(n => n.flags?.subgraph || n.subgraph).map(n => ({ id: n.id, type: n.type, title: n.title }));

            return {
                workflow_tab: this._getWorkflowTabName(),
                nodes_count: nodes.length,
                links_count: links.length,
                groups_count: groups.length,
                nodes_list: nodes.map((n) => ({
                    id: String(n.id),
                    type: n.type,
                    title: n.title || n.type,
                    pos: n.pos,
                    size: n.size,
                    mode: n.mode,
                    flags: n.flags,
                    widgets_values: n.widgets_values,
                    widgets: (n.widgets || []).map(w => ({ name: w.name, type: w.type, value: w.value, options: w.options })),
                    inputs: (n.inputs || []).map(i => ({ name: i.name, type: i.type, link: i.link })),
                    outputs: (n.outputs || []).map(o => ({ name: o.name, type: o.type, links: o.links })),
                    subgraph: serializeNested(n.subgraph || n.graph || n.workflow || n.children),
                })),
                links: links.slice(0, 80),
                groups,
                subgraphs: [...subgraphs, ...subgraphNodes],
            };
        } catch (e) {
            return { nodes_count: 0, nodes_list: [], links: [], groups: [], subgraphs: [], error: String(e) };
        }
    }

    _getWorkflowTabName() {
        // app.graph is the graph belonging to the currently active ComfyUI tab.
        // This keeps node context isolated when the user switches workflow tabs.
        return app.graph?.name || app.graph?.title || "active workflow tab";
    }

    // ── Pending Approval Modal (Install / Node / Workflow) ───────────────────

    _getApprovalKey(approval) {
        if (approval.action === "add_node_to_canvas") return `add_node:${approval.node_name}`;
        if (approval.action === "batch_add_nodes") return `batch:${(approval.nodes||[]).join(",")}`;
        if (approval.action === "arrange_workflow_nodes") return "arrange_workflow_nodes";
        if (approval.action === "ask_user") return `ask:${approval.header || approval.question || "ask"}`;
        if (approval.github_url) return `install:${approval.github_url}`;
        if (approval.action === "execute_workflow") return "execute_workflow";
        if (approval.action === "replace_node") return `replace_node:${approval.node_id}:${approval.new_node_name}`;
        if (approval.action === "select_nodes_and_create_subgraph") return `subgraph:${(approval.node_ids || []).join(",")}:${approval.name}`;
        if (approval.action && approval.action.startsWith("edit_node")) return `edit_node:${approval.node_id || approval.node_name || "unknown"}`;
        if (approval.action) return approval.action;
        return JSON.stringify(approval).slice(0, 80);
    }

    _handlePendingApproval(approval) {
        // Do not show a stale approval badge while settings are still loading.
        if (!this.yoloModeLoaded && approval.action !== "ask_user") {
            this.loadYoloMode().then(() => this._handlePendingApproval(approval));
            return;
        }
        const key = this._getApprovalKey(approval);
        if (approval.action === "ask_user") {
            const questionKey = `ask:${approval.header || approval.question || "question"}`;
            if (this.activeQuestionKeys.has(questionKey)) return;
            this.activeQuestionKeys.add(questionKey);
            this._renderQuestion(approval);
            return;
        }
        if (approval.action === "execute_workflow" && this.sudoRun) {
            this._executeApprovedAction(approval);
            return;
        }
        if (approval.action === "agent_checkpoint" && approval.decision === "ask_user") {
            this._renderQuestion({
                action: "ask_user",
                header: "Agent needs clarification",
                question: approval.question || "I need clarification before continuing.",
                options: approval.options || [{label: "Continue", description: "Continue with the current plan"}]
            });
            return;
        }
        if (approval.action === "use_credential") {
            this._showCredentialApproval(approval);
            return;
        }
        if (this.yoloMode && approval.action !== "execute_workflow") {
            this._executeApprovedAction(approval);
            return;
        }
        if (this.sessionApprovals.has(key)) {
            this._executeApprovedAction(approval);
            return;
        }
        if (approval.action !== "ask_user" && !this.pendingApprovalKeys.has(key)) {
            this.pendingApprovalKeys.add(key);
            this.approvalQueue.push(approval);
            this.renderApprovalQueue();
        }
    }

    renderApprovalQueue() {
        if (this.approvalOverlay) return;
        this.setAgentState("waiting_approval", "Waiting for your approval…");
        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";
        this.approvalOverlay = overlay;
        const modal = document.createElement("div");
        modal.className = "ca-modal";
        const title = document.createElement("h4");
        title.textContent = `Approve ${this.approvalQueue.length} pending action${this.approvalQueue.length === 1 ? "" : "s"}`;
        modal.appendChild(title);
        const intro = document.createElement("p");
        intro.textContent = "Select the actions to approve. Actions you leave unchecked will be declined.";
        intro.style.cssText = "font-size:12px;color:#aab;";
        modal.appendChild(intro);
        const list = document.createElement("div");
        list.style.cssText = "max-height:45vh;overflow:auto;display:flex;flex-direction:column;gap:6px;";
        const checks = [];
        this.approvalQueue.forEach((approval, index) => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex;gap:8px;align-items:flex-start;background:#2b2b38;border:1px solid #414155;border-radius:6px;padding:8px;cursor:pointer;";
            const check = document.createElement("input");
            check.type = "checkbox"; check.checked = true; check.style.marginTop = "3px";
            checks.push(check);
            const text = document.createElement("span");
            const action = approval.action || "action";
            const detail = approval.message || approval.reason || approval.node_name || approval.new_node_name || "";
            text.innerHTML = `<b>${action}</b><br><small>${String(detail).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</small>`;
            row.append(check, text); list.appendChild(row);
        });
        modal.appendChild(list);
        const btns = document.createElement("div"); btns.className = "ca-modal-btns"; btns.style.flexWrap = "wrap";
        const selectAll = document.createElement("button"); selectAll.className = "ca-modal-btn cancel"; selectAll.textContent = "Deselect All";
        selectAll.onclick = () => { const all = checks.every(c => c.checked); checks.forEach(c => c.checked = !all); selectAll.textContent = all ? "Select All" : "Deselect All"; };
        const decline = document.createElement("button"); decline.className = "ca-modal-btn cancel"; decline.textContent = "Decline Selected";
        decline.onclick = () => { overlay.remove(); this.approvalOverlay = null; this.approvalQueue = []; this.pendingApprovalKeys.clear(); this.addMsg("system", "Pending actions declined."); };
        const approve = document.createElement("button"); approve.className = "ca-modal-btn confirm"; approve.textContent = "Approve Selected";
        approve.onclick = async () => {
            const selected = this.approvalQueue.filter((_, i) => checks[i].checked);
            const skipped = this.approvalQueue.length - selected.length;
            overlay.remove(); this.approvalOverlay = null; this.approvalQueue = []; this.pendingApprovalKeys.clear();
            this.setAgentState("working", "Working: applying approved actions…");
            if (skipped) this.addMsg("system", `${skipped} action${skipped === 1 ? "" : "s"} declined.`);
            for (const item of selected) await this._executeApprovedAction(item);
        };
        const approveAll = document.createElement("button");
        approveAll.className = "ca-modal-btn confirm";
        approveAll.style.background = "#15803d";
        approveAll.textContent = "Approve All";
        approveAll.onclick = async () => {
            const all = [...this.approvalQueue];
            overlay.remove(); this.approvalOverlay = null; this.approvalQueue = []; this.pendingApprovalKeys.clear();
            this.setAgentState("working", "Working: applying all approved actions…");
            for (const item of all) await this._executeApprovedAction(item);
        };
        btns.append(selectAll, decline, approve, approveAll); modal.appendChild(btns); overlay.appendChild(modal); document.body.appendChild(overlay);
        modal.addEventListener("click", e => e.stopPropagation());
        overlay.addEventListener("click", e => { if (e.target === overlay) { overlay.remove(); this.approvalOverlay = null; } });
    }

    queuePendingApprovals(actions) {
        const list = Array.isArray(actions) ? actions : [];
        list.forEach(action => this._handlePendingApproval(action));
    }

    _showCredentialApproval(approval) {
        const title = document.createElement("h4");
        title.textContent = "Allow credential use?";
        const desc = `The agent requests use of configured ${approval.credential} for:\n${approval.purpose}\n\nTarget: ${approval.endpoint_or_target}\nConfigured: ${approval.configured ? "yes" : "no"}\n\nThe secret value will not be shown in chat or sent to the model.`;
        this._showConfirmModal("Allow credential use?", desc, async () => {
            try {
                await this.apiJson("/comfyagent/credentials/grant", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({credential: approval.credential, purpose: approval.purpose, endpoint_or_target: approval.endpoint_or_target})
                });
                this.addMsg("system", `Credential use granted for this scoped operation.`);
            } catch (e) { this.addMsg("system", `Credential grant failed: ${e.message}`); }
        }, () => this.addMsg("system", "Credential use declined."));
    }

    _showApprovalModal(title, desc, approval, key) {
        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";
        const modal = document.createElement("div");
        modal.className = "ca-modal";
        const h = document.createElement("h4");
        h.textContent = title;
        modal.appendChild(h);
        const p = document.createElement("p");
        p.style.cssText = "font-size:13px; line-height:1.5; white-space:pre-wrap; margin:8px 0;";
        p.textContent = desc;
        modal.appendChild(p);
        const btns = document.createElement("div");
        btns.className = "ca-modal-btns";
        btns.style.flexWrap = "wrap";

        const declineBtn = document.createElement("button");
        declineBtn.className = "ca-modal-btn cancel";
        declineBtn.textContent = "Decline";
        declineBtn.onclick = () => { overlay.remove(); this.addMsg("system", "Action declined by user."); };

        const onceBtn = document.createElement("button");
        onceBtn.className = "ca-modal-btn confirm";
        onceBtn.textContent = "Allow Once";
        onceBtn.onclick = () => { overlay.remove(); this._executeApprovedAction(approval); };

        const alwaysBtn = document.createElement("button");
        alwaysBtn.className = "ca-modal-btn confirm";
        alwaysBtn.style.background = "#2563eb";
        alwaysBtn.textContent = "Always Allow This Session";
        alwaysBtn.title = "Auto-approve this action type for the rest of this browser session";
        alwaysBtn.onclick = () => { this.sessionApprovals.add(key); overlay.remove(); this.addMsg("system", `Auto-approved "${key}" for this session.`); this._executeApprovedAction(approval); };

        btns.appendChild(declineBtn);
        btns.appendChild(onceBtn);
        btns.appendChild(alwaysBtn);
        modal.appendChild(btns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    }

    _renderQuestion(approval) {
        const wrap = document.createElement("div");
        wrap.className = "ca-question";
        const h = document.createElement("h4");
        h.textContent = approval.header || "Question";
        wrap.appendChild(h);
        const q = document.createElement("p");
        q.textContent = `${approval.question || ""}${approval.multiple ? " (select all that apply)" : ""}`;
        wrap.appendChild(q);
        const opts = document.createElement("div");
        opts.className = "ca-qopts";
        const selected = new Set();
        const isMultiple = approval.multiple === true;
        (approval.options || []).forEach(opt => {
            const btn = document.createElement("button");
            btn.className = "ca-qopt";
            btn.innerHTML = `${opt.label}<small>${opt.description || ""}</small>`;
            btn.onclick = async () => {
                if (isMultiple) {
                    if (selected.has(opt.label)) { selected.delete(opt.label); btn.style.background = ""; }
                    else if (!approval.max_selections || selected.size < approval.max_selections) { selected.add(opt.label); btn.style.background = "#2563eb"; }
                    submitBtn.disabled = selected.size < (approval.min_selections || 1);
                    return;
                }
                wrap.remove();
                this.activeQuestionKeys.delete(`ask:${approval.header || approval.question || "question"}`);
                await this.submitQuestionAnswer(opt.label);
            };
            opts.appendChild(btn);
        });
        let submitBtn = null;
        if (isMultiple) {
            submitBtn = document.createElement("button");
            submitBtn.className = "ca-qopt";
            submitBtn.textContent = "Continue with selected";
            submitBtn.disabled = true;
            submitBtn.onclick = async () => {
                if (selected.size < (approval.min_selections || 1)) return;
                wrap.remove();
                this.activeQuestionKeys.delete(`ask:${approval.header || approval.question || "question"}`);
                await this.submitQuestionAnswer([...selected].join(", "));
            };
            opts.appendChild(submitBtn);
        }
        // Custom answer
        const customBtn = document.createElement("button");
        customBtn.className = "ca-qopt";
        customBtn.style.background = "#1e293b";
        customBtn.innerHTML = `Type your own answer<small>Custom response</small>`;
        customBtn.onclick = () => {
            this._showInputModal("Your answer", approval.question, (val) => {
                if (!val) return;
                wrap.remove();
                this.activeQuestionKeys.delete(`ask:${approval.header || approval.question || "question"}`);
                this.inputEl.value = val;
                this.sendMessage();
            });
        };
        opts.appendChild(customBtn);
        wrap.appendChild(opts);
        this.messagesEl.appendChild(wrap);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    async submitQuestionAnswer(answer) {
        this.addMsg("user", answer);
        this.setStatus("Thinking...", "#3a3a2e");
        const loadingEl = this.addMsg("loading", "...");
        try {
            const data = await this.apiJson("/comfyagent/sessions/answer", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({answer, canvas_context: this._getCanvasContext()})
            });
            this.removeMsg(loadingEl);
            if (data.error) this.addMsg("assistant", `[Error]: ${data.error}`);
            else {
                if (data.tool_trace?.length) this.messagesEl.appendChild(this._createThinkingFromTrace(data.tool_trace));
                this.addAssistantResponse(data.response, data.pending_approval || data.pending_approvals);
                if (data.pending_approvals) this.queuePendingApprovals(data.pending_approvals);
                else if (data.pending_approval) this.queuePendingApprovals([data.pending_approval]);
            }
        } catch (e) {
            this.removeMsg(loadingEl);
            this.addMsg("assistant", `[Connection Error]: ${e.message}`);
        } finally { this.setStatus("Ready", "#2e4a2e"); }
    }

    _showInputModal(title, message, onSubmit) {
        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";
        const modal = document.createElement("div");
        modal.className = "ca-modal";
        const h = document.createElement("h4"); h.textContent = title;
        const p = document.createElement("p"); p.textContent = message;
        p.style.cssText = "font-size:13px;white-space:pre-wrap;";
        const input = document.createElement("textarea");
        input.className = "ca-textarea"; input.style.minHeight = "80px";
        const buttons = document.createElement("div"); buttons.className = "ca-modal-btns";
        const cancel = document.createElement("button"); cancel.className = "ca-modal-btn cancel"; cancel.textContent = "Cancel";
        cancel.onclick = () => overlay.remove();
        const submit = document.createElement("button"); submit.className = "ca-modal-btn confirm"; submit.textContent = "Submit";
        submit.onclick = () => { const value = input.value.trim(); overlay.remove(); if (value) onSubmit(value); };
        buttons.append(cancel, submit);
        modal.append(h, p, input, buttons); overlay.appendChild(modal); document.body.appendChild(overlay);
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
        modal.addEventListener("click", e => e.stopPropagation());
        input.focus();
    }

    async _executeApprovedAction(approval) {
        const action = approval.action === "add_node_to_canvas" ? "add_node" : (approval.github_url ? "install" : approval.action || "execute");
        const executionKey = this._getApprovalKey(approval) + ":" + JSON.stringify(approval).slice(0, 240);
        if (this.executedActionKeys.has(executionKey)) return;
        this.executedActionKeys.add(executionKey);
        if (action === "install") {
            this.addMsg("system", "Installing... please wait.");
            try {
                const data = await this.apiJson("/comfyagent/install", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ github_url: approval.github_url }),
                });
                this.addMsg("system", `Install result: ${data.message || data.status}`);
                if (data.status === "success") this._offerRestart();
            } catch (e) {
                this.addMsg("system", `Install failed: ${e.message}`);
            }
        } else if (action === "add_node") {
            const node = this.addNodeToActiveCanvas(approval.node_name);
            await this.reportActionResult(action, {success: !!node, node_id: node?.id, node_type: node?.type});
        } else if (action === "batch_add_nodes") {
            let added = 0;
            const base = app.canvas?.convertCanvasWindowToCanvas
                ? app.canvas.convertCanvasWindowToCanvas([window.innerWidth / 2, window.innerHeight / 2])
                : [300, 200];
            for (let index = 0; index < (approval.nodes || []).length; index++) {
                const n = approval.nodes[index];
                const col = index % 3;
                const row = Math.floor(index / 3);
                const created = this.addNodeToActiveCanvas(n, [base[0] + col * 300, base[1] + row * 220]);
                if (created) added++;
                // Small stagger to avoid graph race
                await new Promise(r => setTimeout(r, 80));
            }
            this.addMsg("system", `Added ${added}/${approval.nodes.length} nodes in a grid. The canvas has been refreshed; I will inspect the new node IDs before connecting anything.`);
            await this.reportActionResult(action, {success: added === approval.nodes.length, added, requested: approval.nodes});
            // Send verified canvas state on the next explicit user turn. Do not
            // automatically chain guessed connections after a batch mutation.
        } else if (action === "execute_workflow") {
            await this.queueActiveWorkflow(approval);
        } else if (action === "arrange_workflow_nodes") {
            await this.reportActionResult(action, this.arrangeWorkflowNodes());
        } else if (action === "replace_node") {
            await this.reportActionResult(action, this.replaceNodeOnCanvas(approval.node_id, approval.new_node_name));
        } else if (action === "select_nodes_and_create_subgraph") {
            await this.reportActionResult(action, this.createSubgraphFromNodes(approval.node_ids, approval.name));
        } else if (action === "batch_connect_nodes") {
            const result = this.batchConnectNodes(approval.connections || []);
            await this.reportActionResult(action, result);
        } else if (action.startsWith("edit_node") || action.startsWith("workflow_edit") || action === "delete_nodes" || action === "connect_nodes") {
            await this.reportActionResult(action, await this._executeWorkflowEdit(approval));
        } else if (action === "ask_user") {
            this._renderQuestion(approval);
        } else {
            // Fallback: treat as generic executed action
            this.addMsg("system", `Executed: ${approval.message || action}`);
        }
    }

    createSubgraphFromNodes(nodeIds, name) {
        const ids = (nodeIds || []).map(String);
        const nodes = ids.map(id => this._findNodeById(id));
        if (!nodes.length || nodes.some(node => !node)) {
            return {success: false, error: "One or more requested node IDs were not found on the active canvas."};
        }
        nodes.forEach(node => { node.selected = true; });
        const graph = app.graph;
        // ComfyUI builds that provide a native subgraph API take precedence.
        const native = app.createSubgraph || graph.createSubgraph || graph.createSubGraph;
        if (typeof native === "function") {
            try {
                const result = native.call(app.createSubgraph ? app : graph, nodes, name);
                app.canvas?.setDirty?.(true, true);
                return {success: true, native: true, name, node_ids: ids, result: result?.id || result?.name || "created"};
            } catch (e) {
                return {success: false, native: true, error: e.message};
            }
        }
        // Safe fallback: create a visual group. This is intentionally reported
        // as a group, never misrepresented as a true nested execution graph.
        if (typeof LiteGraph !== "undefined" && typeof LiteGraph.LGraphGroup === "function") {
            const group = new LiteGraph.LGraphGroup(name || "ComfyAgent Group");
            const bounds = this._nodesBounds(nodes);
            group.pos = [bounds[0] - 30, bounds[1] - 50];
            group._size = [Math.max(220, bounds[2] - bounds[0] + 60), Math.max(120, bounds[3] - bounds[1] + 80)];
            graph.addGroup?.(group);
            graph.setDirtyCanvas?.(true, true);
            app.canvas?.setDirty?.(true, true);
            return {success: true, native: false, visual_group: true, name, node_ids: ids, message: "Created a visual group; this ComfyUI build does not expose a native nested-subgraph API."};
        }
        return {success: false, error: "This ComfyUI build does not expose a native subgraph or group API."};
    }

    batchConnectNodes(connections) {
        if (!Array.isArray(connections) || !connections.length) return {success: false, error: "No connections supplied."};
        let connected = 0;
        const errors = [];
        for (const connection of connections) {
            try {
                if (this._connectNodes(connection.from_node_id, connection.from_slot, connection.to_node_id, connection.to_slot)) connected++;
            } catch (e) { errors.push(e.message); }
        }
        return {success: connected === connections.length, connected, requested: connections.length, errors};
    }

    _nodesBounds(nodes) {
        const left = Math.min(...nodes.map(n => n.pos?.[0] || 0));
        const top = Math.min(...nodes.map(n => n.pos?.[1] || 0));
        const right = Math.max(...nodes.map(n => (n.pos?.[0] || 0) + (n.size?.[0] || 200)));
        const bottom = Math.max(...nodes.map(n => (n.pos?.[1] || 0) + (n.size?.[1] || 100)));
        return [left, top, right, bottom];
    }

    async reportActionResult(action, result) {
        try {
            this.setAgentState("working", "Working: continuing task after action…");
            const actionId = `${action}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
            const response = await this.apiJson("/comfyagent/action_result", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({action, action_id: actionId, result: result || {}, canvas_context: this._getCanvasContext()})
            });
            if (response.tool_trace?.length) this.messagesEl.appendChild(this._createThinkingFromTrace(response.tool_trace));
            if (response.response) this.addAssistantResponse(response.response, response.pending_approval || response.pending_approvals);
            if (response.pending_approvals) this.queuePendingApprovals(response.pending_approvals);
            else if (response.pending_approval) this.queuePendingApprovals([response.pending_approval]);
            if (!this.approvalQueue.length) this.setAgentState("idle");
        } catch (e) { this.addMsg("system", `Agent continuation failed: ${e.message}`); }
    }

    arrangeWorkflowNodes() {
        const nodes = app.graph?._nodes || [];
        if (!nodes.length) { this.addMsg("system", "No nodes to arrange."); return {success: false, error: "No nodes"}; }
        const base = app.canvas?.convertCanvasWindowToCanvas
            ? app.canvas.convertCanvasWindowToCanvas([window.innerWidth / 2, window.innerHeight / 2])
            : [300, 200];
        const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
        nodes.forEach((node, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            node.pos = [base[0] + col * 300, base[1] + row * 220];
        });
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.addMsg("system", `Arranged ${nodes.length} nodes. Connections and node settings were not changed.`);
        return {success: true, arranged: nodes.length};
    }

    addNodeToActiveCanvas(nodeName, position) {
        try {
            if (!nodeName || !app.graph) throw new Error("No node name or active workflow graph was found.");
            if (typeof LiteGraph === "undefined" || typeof LiteGraph.createNode !== "function") {
                throw new Error("ComfyUI's node editor API is unavailable.");
            }
            const node = LiteGraph.createNode(nodeName);
            if (!node) throw new Error(`Node '${nodeName}' is not registered in ComfyUI.`);
            const canvas = app.canvas;
            const center = canvas?.graph_mouse || [300, 200];
            const graphPos = position || (canvas?.convertCanvasWindowToCanvas
                ? canvas.convertCanvasWindowToCanvas([window.innerWidth / 2, window.innerHeight / 2])
                : center);
            node.pos = [graphPos[0] - (node.size?.[0] || 140) / 2, graphPos[1] - 40];
            app.graph.add(node);
            canvas?.selectNode?.(node, false);
            canvas?.setDirty?.(true, true);
            if (app.graph.setDirtyCanvas) app.graph.setDirtyCanvas(true, true);
            this.addMsg("system", `${nodeName} was added to the active workflow tab.`);
            return node;
        } catch (e) {
            this.addMsg("system", `Could not add node: ${e.message}`);
            return null;
        }
    }

    async _executeWorkflowEdit(approval) {
        try {
            if (approval.action === "edit_node_widget") {
                return {success: !!this._editNodeWidget(approval.node_id, approval.widget_name, approval.new_value)};
            } else if (approval.action === "delete_nodes") {
                return {success: !!this._deleteNodes(approval.node_ids)};
            } else if (approval.action === "connect_nodes") {
                return {success: !!this._connectNodes(approval.from_node_id, approval.from_slot, approval.to_node_id, approval.to_slot)};
            } else {
                this.addMsg("system", `Unknown edit action: ${approval.action}`);
            }
        } catch (e) {
            this.addMsg("system", `Edit failed: ${e.message}`);
            return {success: false, error: e.message};
        }
    }

    _findNodeById(nodeId) {
        if (!app.graph) return null;
        const idStr = String(nodeId);
        // Try fast lookup
        if (app.graph.getNodeById) {
            const n = app.graph.getNodeById(nodeId) || app.graph.getNodeById(Number(nodeId));
            if (n) return n;
        }
        return (app.graph._nodes || []).find(n => String(n.id) === idStr) || null;
    }

    _coerceWidgetValue(current, newValStr) {
        if (current === null || current === undefined) return newValStr;
        const t = typeof current;
        if (t === "number") {
            const num = Number(newValStr);
            return isNaN(num) ? newValStr : num;
        }
        if (t === "boolean") {
            if (newValStr.toLowerCase() === "true") return true;
            if (newValStr.toLowerCase() === "false") return false;
            return newValStr;
        }
        return newValStr;
    }

    _editNodeWidget(nodeId, widgetName, newValueStr) {
        const node = this._findNodeById(nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found on active canvas.`);
        // Find widget
        let widget = (node.widgets || []).find(w => w.name === widgetName);
        // Some nodes store values in widgets_values
        if (!widget && node.widgets_values) {
            // Try by index if widgetName is numeric
            const idx = parseInt(widgetName, 10);
            if (!isNaN(idx) && idx >= 0 && idx < node.widgets_values.length) {
                const oldVal = node.widgets_values[idx];
                const newVal = this._coerceWidgetValue(oldVal, newValueStr);
                node.widgets_values[idx] = newVal;
                if (node.widgets && node.widgets[idx]) node.widgets[idx].value = newVal;
                app.graph.setDirtyCanvas?.(true, true);
                app.canvas?.setDirty?.(true, true);
                this.addMsg("system", `Node ${nodeId} widget [${idx}] set to ${newVal}.`);
                return true;
            }
        }
        if (!widget) {
            const avail = (node.widgets || []).map(w => w.name).join(", ") || "no widgets found";
            throw new Error(`Widget '${widgetName}' not found on node ${nodeId}. Available: ${avail}`);
        }
        const newVal = this._coerceWidgetValue(widget.value, newValueStr);
        widget.value = newVal;
        // Also sync widgets_values if present
        if (node.widgets_values) {
            const idx = node.widgets.indexOf(widget);
            if (idx >= 0) node.widgets_values[idx] = newVal;
        }
        // Do not call node.onWidgetChanged directly. Newer ComfyUI versions
        // expect an internal event object there and throw a "sourceNodeId"
        // error when called with the legacy arguments.
        if (typeof widget.callback === "function") {
            try { widget.callback(newVal, app.canvas, node); } catch { /* value remains set */ }
        }
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.addMsg("system", `Node ${nodeId} (${node.type}) widget '${widgetName}' set to ${newVal}.`);
        return true;
    }

    _deleteNodes(nodeIds) {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error("No node IDs provided.");
        let removed = 0;
        for (const id of nodeIds) {
            const node = this._findNodeById(id);
            if (node) {
                app.graph.remove(node);
                removed++;
            }
        }
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.addMsg("system", `Deleted ${removed}/${nodeIds.length} nodes.`);
        return removed === nodeIds.length;
    }

    replaceNodeOnCanvas(nodeId, newNodeName) {
        const oldNode = this._findNodeById(nodeId);
        if (!oldNode) { this.addMsg("system", `Cannot replace: node ${nodeId} was not found.`); return {success: false, error: "old node not found"}; }
        const newNode = LiteGraph.createNode(newNodeName);
        if (!newNode) { this.addMsg("system", `Cannot replace: ${newNodeName} is unavailable.`); return {success: false, error: "new node unavailable"}; }
        const oldPos = [...(oldNode.pos || [300, 200])];
        const oldWidgets = Object.fromEntries((oldNode.widgets || []).map(w => [w.name, w.value]));
        const inputLinks = (oldNode.inputs || []).map((slot, index) => ({slot, index})).filter(x => x.slot.link != null);
        const outputLinks = [];
        (oldNode.outputs || []).forEach((slot, index) => (slot.links || []).forEach(linkId => outputLinks.push({slot, index, linkId})));
        newNode.pos = oldPos;
        (newNode.widgets || []).forEach(w => { if (Object.prototype.hasOwnProperty.call(oldWidgets, w.name)) w.value = oldWidgets[w.name]; });
        app.graph.add(newNode);
        const inputIndex = (slot) => (newNode.inputs || []).findIndex(s => s.name === slot.name || s.type === slot.type);
        const outputIndex = (slot) => (newNode.outputs || []).findIndex(s => s.name === slot.name || s.type === slot.type);
        let kept = 0;
        inputLinks.forEach(({slot}) => {
            const link = app.graph.links?.[slot.link] || app.graph._links?.[slot.link];
            const source = link && this._findNodeById(link.origin_id);
            const targetSlot = inputIndex(slot);
            if (source && targetSlot >= 0) { try { source.connect(link.origin_slot, newNode, targetSlot); kept++; } catch {} }
        });
        outputLinks.forEach(({slot, linkId}) => {
            const link = app.graph.links?.[linkId] || app.graph._links?.[linkId];
            const target = link && this._findNodeById(link.target_id);
            const sourceSlot = outputIndex(slot);
            if (target && sourceSlot >= 0) { try { newNode.connect(sourceSlot, target, link.target_slot); kept++; } catch {} }
        });
        app.graph.remove(oldNode);
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.addMsg("system", `Replaced ${oldNode.type}#${nodeId} with ${newNodeName}. Preserved ${kept} compatible connection(s).`);
        return {success: true, old_node_id: nodeId, new_node_id: newNode.id, preserved_connections: kept};
    }

    _findSlotIndex(node, slotNameOrIndex, isInput) {
        const slots = isInput ? (node.inputs || []) : (node.outputs || []);
        // If numeric string, treat as index
        const asNum = parseInt(slotNameOrIndex, 10);
        if (!isNaN(asNum) && String(asNum) === String(slotNameOrIndex).trim()) {
            if (asNum >= 0 && asNum < slots.length) return asNum;
        }
        // Find by name
        const idx = slots.findIndex(s => s.name === slotNameOrIndex || String(s.name).toLowerCase() === String(slotNameOrIndex).toLowerCase());
        if (idx >= 0) return idx;
        // Fallback: try type matching if slot name is a type
        const avail = slots.map((s, i) => `${i}:${s.name}(${s.type})`).join(", ");
        throw new Error(`${isInput ? "Input" : "Output"} slot '${slotNameOrIndex}' not found on node ${node.id} (${node.type}). Available: ${avail || "none"}`);
    }

    _connectNodes(fromId, fromSlot, toId, toSlot) {
        const fromNode = this._findNodeById(fromId);
        const toNode = this._findNodeById(toId);
        if (!fromNode) throw new Error(`Source node ${fromId} not found.`);
        if (!toNode) throw new Error(`Target node ${toId} not found.`);
        const outIdx = this._findSlotIndex(fromNode, fromSlot, false);
        const inIdx = this._findSlotIndex(toNode, toSlot, true);
        // LiteGraph connect: fromNode.connect(outIdx, toNode, inIdx)
        fromNode.connect(outIdx, toNode, inIdx);
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.addMsg("system", `Connected ${fromNode.type}#${fromId}:${fromSlot} -> ${toNode.type}#${toId}:${toSlot}`);
        return true;
    }

    async queueActiveWorkflow(runOptions = {}) {
        try {
            // ComfyUI's /prompt endpoint needs API-format node objects
            // ({class_type, inputs}), not the editor serialization ({nodes, links}).
            const workflow = await this._serializeActiveWorkflow();
            if (!workflow || Object.keys(workflow).length === 0) {
                this.addMsg("system", "The active workflow is empty and cannot be executed.");
                return;
            }
            // Use ComfyUI's public prompt endpoint so queue bookkeeping,
            // progress events, and the active workflow tab stay consistent.
            const data = await this.apiJson("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: workflow }),
            });
            this.addMsg("system", `Workflow queued successfully${data.prompt_id ? ` (${data.prompt_id})` : ""}.`);
            if (data.prompt_id && (runOptions.return_logs !== false || runOptions.wait_for_completion !== false)) {
                this.pollExecutionResult(data.prompt_id, runOptions);
            }
        } catch (e) {
            this.addMsg("system", `Workflow could not be queued: ${e.message}`);
        }
    }

    async pollExecutionResult(promptId, runOptions = {}) {
        const maxAttempts = runOptions.wait_for_completion === false ? 1 : 180;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                // ComfyUI's native history endpoint contains outputs and errors.
                const data = await this.apiJson(`/history/${encodeURIComponent(promptId)}`);
                const record = data[promptId] || data;
                if (!record || !Object.keys(record).length) continue;
                const status = record.status || {};
                const statusText = status.status_str || status.status || "completed";
                const messages = status.messages || [];
                const errorText = messages.map(m => Array.isArray(m) ? JSON.stringify(m) : String(m)).join("\n");
                if (statusText === "error" || statusText === "failed") {
                    this.addMsg("system", `Test run failed:\n${errorText || "ComfyUI reported an execution error."}`);
                    return;
                }
                const outputs = record.outputs || {};
                const outputCount = Object.keys(outputs).length;
            this.addMsg("system", `Test run completed. Outputs: ${outputCount} node(s).${errorText ? `\nConsole/status:\n${errorText}` : ""}`);
            // Send execution evidence back through the normal agent loop so
            // it can report based on actual ComfyUI history, not validation alone.
            this.reportActionResult("execute_workflow_result", {
                success: statusText !== "error" && statusText !== "failed",
                run_evidence: true,
                prompt_id: promptId,
                status: statusText,
                output_count: outputCount,
                logs: errorText,
            });
                if (runOptions.return_logs !== false) {
                    const preview = JSON.stringify(outputs, null, 2).slice(0, 3000);
                    this.addMsg("system", `Execution output details:\n${preview}`);
                }
                return;
            } catch (e) {
                // History may not be available until execution completes.
                if (attempt === maxAttempts - 1) this.addMsg("system", `Could not retrieve test-run logs: ${e.message}`);
            }
        }
    }

    async _serializeActiveWorkflow() {
        try {
            const graph = app.graph;
            if (!graph) return null;
            // This is the supported ComfyUI frontend conversion used by Run.
            if (typeof app.graphToPrompt === "function") {
                const prompt = await app.graphToPrompt();
                if (prompt?.output) return prompt.output;
                if (prompt?.prompt) return prompt.prompt;
                if (prompt && typeof prompt === "object") return prompt;
            }
            if (typeof graphToPrompt === "function") {
                const prompt = await graphToPrompt(graph);
                if (prompt?.output) return prompt.output;
                if (prompt?.prompt) return prompt.prompt;
                if (prompt && typeof prompt === "object") return prompt;
            }
            if (typeof graph.serialize === "function") {
                const serialized = graph.serialize();
                // Fallback conversion for older ComfyUI builds.
                if (Array.isArray(serialized.nodes)) {
                    const output = {};
                    for (const node of serialized.nodes) {
                        const inputs = {};
                        for (const input of node.inputs || []) {
                            if (input.link !== null && input.link !== undefined) {
                                const link = serialized.links?.find(l => String(l[0]) === String(input.link));
                                if (link) inputs[input.name] = [String(link[1]), link[2]];
                            }
                        }
                        const values = node.widgets_values || [];
                        (node.widgets || []).forEach((w, i) => {
                            if (values[i] !== undefined) inputs[w.name] = values[i];
                        });
                        output[String(node.id)] = {class_type: node.type, inputs};
                    }
                    return output;
                }
                return serialized;
            }
            if (typeof graph.toPrompt === "function") return await graph.toPrompt();
            return null;
        } catch {
            return null;
        }
    }

    _offerRestart() {
        this._showConfirmModal(
            "Restart ComfyUI?",
            "The new custom node requires a server restart to load.\nYour chat session will be preserved.\n\nRestart now?",
            async () => {
                // Save restart flag BEFORE the server dies
                sessionStorage.setItem("comfyagent_restarting", "true");
                this.addMsg("system", "Restarting server...");
                try {
                    await fetch("/comfyagent/restart", { method: "POST" });
                } catch {
                    // Expected: server dies
                }
                // Poll for server to come back
                this._pollForReconnect();
            },
            () => {
                this.addMsg("system", "Restart skipped. You can restart manually later.");
            }
        );
    }

    // ── Auto-Reconnect after Restart ───────────────────────────────────────

    _pollForReconnect() {
        this.setStatus("Restarting...", "#4a2e2e");
        let attempts = 0;
        const maxAttempts = 60;
        const interval = setInterval(async () => {
            attempts++;
            try {
                const resp = await fetch("/comfyagent/sessions", { signal: AbortSignal.timeout(2000) });
                if (resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
                    clearInterval(interval);
                    this.setStatus("Reconnected", "#2e4a2e");
                    this.addMsg("system", "Server restarted successfully. Session restored.");
                    await this.loadSession();
                    // Proactive trigger: tell AI we're back
                    this.inputEl.value = "";
                    this._sendSystemResume();
                }
            } catch {
                if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    this.setStatus("Offline", "#4a2e2e");
                    this.addMsg("system", "Server did not come back after 2 minutes. Please restart manually.");
                }
            }
        }, 2000);
    }

    async _sendSystemResume() {
        try {
            const data = await this.apiJson("/comfyagent/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: "[SYSTEM] ComfyUI has restarted after a custom node installation. The session has been restored. Please acknowledge and let the user know the installation is complete and the new nodes are now available.",
                    canvas_context: this._getCanvasContext(),
                }),
            });
            if (data.response) this.addAssistantResponse(data.response, data.pending_approval || data.pending_approvals);
        } catch {
            // Ignore
        }
    }

    // ── Post-Restart Check (page reload scenario) ──────────────────────────

    checkPostRestart() {
        if (sessionStorage.getItem("comfyagent_restarting") === "true") {
            sessionStorage.removeItem("comfyagent_restarting");
            // Auto-open panel and send resume
            this.toggle(true);
            setTimeout(() => {
                this.addMsg("system", "Session restored after restart.");
                this._sendSystemResume();
            }, 500);
        }
    }

    // ── Proactive Foreground Trigger ───────────────────────────────────────

    setupForegroundTrigger() {
        let lastHidden = false;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                lastHidden = true;
            } else if (lastHidden) {
                lastHidden = false;
                // UI came back to foreground -- check if we missed a restart
                if (sessionStorage.getItem("comfyagent_restarting") === "true") {
                    sessionStorage.removeItem("comfyagent_restarting");
                    this.toggle(true);
                    this._pollForReconnect();
                }
            }
        });
    }

    // ── Settings Modal ─────────────────────────────────────────────────────

    async openSettingsModal() {
        const existing = document.querySelector(".ca-settings-overlay");
        if (existing) {
            existing.querySelector("input")?.focus();
            return;
        }
        // Open immediately from cached/default values. Network requests must
        // never block or randomly delay the settings UI.
        const settings = {
            ...(this.cachedSettings || {}),
            api_endpoint: this.cachedSettings?.api_endpoint || "https://openrouter.ai/api/v1",
            model_id: this.cachedSettings?.model_id || "auto",
            yolo_mode: this.yoloMode,
            sudo_run: this.sudoRun,
            skip_session_delete_approval: this.skipSessionDeleteApproval,
        };

        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";
        overlay.classList.add("ca-settings-overlay");

        const modal = document.createElement("div");
        modal.className = "ca-modal";

        // Build form safely (no innerHTML with user data)
        const title = document.createElement("h4");
        title.textContent = "ComfyAgent Settings";
        modal.appendChild(title);

        const fields = [
            { key: "api_endpoint", label: "API Endpoint (e.g. https://openrouter.ai/api/v1 or http://localhost:1234/v1)", type: "text" },
            { key: "api_key", label: "API Key (OpenRouter or custom endpoint — leave empty if none)", type: "password" },
            { key: "model_id", label: "Model ID (or 'auto' for best free OpenRouter model)", type: "text" },
            { key: "civitai_key", label: "Civitai API Key (optional)", type: "password" },
            { key: "github_token", label: "GitHub Token (optional)", type: "password" },
        ];

        const inputs = {};
        for (const f of fields) {
            const lbl = document.createElement("label");
            lbl.textContent = f.label;
            modal.appendChild(lbl);

            const inp = document.createElement("input");
            inp.type = f.type;
            if (f.key === "model_id") inp.setAttribute("list", "ca-model-options");
            inp.value = settings[f.key] === MASKED_VALUE ? "" : (settings[f.key] || "");
            if (settings[f.key] === MASKED_VALUE) {
                inp.placeholder = "(saved, enter new value to change)";
            }
            modal.appendChild(inp);
            inputs[f.key] = { input: inp, wasMasked: settings[f.key] === MASKED_VALUE };
        }

        const modelList = document.createElement("datalist");
        modelList.id = "ca-model-options";
        modal.appendChild(modelList);
        const modelLoading = document.createElement("span");
        modelLoading.textContent = " Loading model suggestions...";
        modelLoading.style.cssText = "font-size:11px;color:#94a3b8;";
        modal.appendChild(modelLoading);

        const yoloLabel = document.createElement("label");
        yoloLabel.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:12px;color:#fca5a5;";
        const yoloInput = document.createElement("input");
        yoloInput.type = "checkbox";
        yoloInput.checked = this.yoloMode;
        yoloInput.style.width = "auto";
        yoloLabel.appendChild(yoloInput);
        yoloLabel.appendChild(document.createTextNode("YOLO mode: auto-approve workflow/file actions"));
        modal.appendChild(yoloLabel);
        const yoloNote = document.createElement("p");
        yoloNote.textContent = "Warning: YOLO mode can add, edit, delete, install, and run without approval. Clarifying questions remain interactive.";
        yoloNote.style.cssText = "font-size:11px;color:#fca5a5;margin:3px 0 0;";
        modal.appendChild(yoloNote);

        const sudoLabel = document.createElement("label");
        sudoLabel.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px;color:#fbbf24;";
        const sudoInput = document.createElement("input");
        sudoInput.type = "checkbox";
        sudoInput.checked = this.sudoRun;
        sudoInput.style.width = "auto";
        sudoLabel.appendChild(sudoInput);
        sudoLabel.appendChild(document.createTextNode("Sudo Run: auto-approve workflow execution only"));
        modal.appendChild(sudoLabel);
        const sudoNote = document.createElement("p");
        sudoNote.textContent = "Sudo Run does not approve node edits, deletes, connections, plugin installs, or code changes. It only skips the Run Workflow confirmation.";
        sudoNote.style.cssText = "font-size:11px;color:#fbbf24;margin:3px 0 0;";
        modal.appendChild(sudoNote);

        const deleteLabel = document.createElement("label");
        deleteLabel.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px;color:#fbbf24;";
        const deleteInput = document.createElement("input");
        deleteInput.type = "checkbox";
        deleteInput.checked = settings.skip_session_delete_approval === true;
        deleteInput.style.width = "auto";
        deleteLabel.appendChild(deleteInput);
        deleteLabel.appendChild(document.createTextNode("Skip approval when deleting sessions"));
        modal.appendChild(deleteLabel);

        const btns = document.createElement("div");
        btns.className = "ca-modal-btns";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "ca-modal-btn cancel";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => overlay.remove();

        const saveBtn = document.createElement("button");
        saveBtn.className = "ca-modal-btn confirm";
        saveBtn.textContent = "Save";
        saveBtn.onclick = async () => {
            const update = {};
            for (const [key, obj] of Object.entries(inputs)) {
                const val = obj.input.value;
                if (obj.wasMasked && val === "") {
                    // User didn't change masked field -- send sentinel to keep it
                    update[key] = MASKED_VALUE;
                } else {
                    update[key] = val;
                }
            }
            update.yolo_mode = yoloInput.checked;
            update.sudo_run = sudoInput.checked;
            update.skip_session_delete_approval = deleteInput.checked;
            try {
                await this.apiJson("/comfyagent/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(update),
                });
                this.addMsg("system", "Settings saved.");
                this.yoloMode = yoloInput.checked;
                this.sudoRun = sudoInput.checked;
                this.skipSessionDeleteApproval = deleteInput.checked;
                this.cachedSettings = {...this.cachedSettings, ...update};
            } catch (e) {
                this.addMsg("system", `Failed to save settings: ${e.message}`);
            }
            overlay.remove();
        };

        btns.appendChild(cancelBtn);
        btns.appendChild(saveBtn);
        modal.appendChild(btns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Load settings in the background and update only untouched fields.
        this.apiJson("/comfyagent/settings").then(remote => {
            this.cachedSettings = remote;
            for (const [key, obj] of Object.entries(inputs)) {
                if (!obj.input.value && remote[key] && remote[key] !== MASKED_VALUE) obj.input.value = remote[key];
                if (remote[key] === MASKED_VALUE) { obj.wasMasked = true; obj.input.placeholder = "(saved, enter new value to change)"; }
            }
            yoloInput.checked = remote.yolo_mode === true;
            sudoInput.checked = remote.sudo_run === true;
            deleteInput.checked = remote.skip_session_delete_approval === true;
        }).catch(() => {});
        // Model discovery is intentionally background-only; manual entry works
        // immediately even when a custom endpoint is slow or unavailable.
        this.apiJson("/comfyagent/models").then(modelData => {
            (modelData.all_models || []).forEach(model => {
                const option = document.createElement("option");
                option.value = model.id;
                option.textContent = model.name || model.id;
                modelList.appendChild(option);
            });
            modelLoading.remove();
        }).catch(() => { modelLoading.textContent = " Model suggestions unavailable (manual entry still works)."; });

        // Only close when clicking the dimmed backdrop itself, not the modal or its children
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.remove();
        });
        // Prevent clicks inside modal from bubbling to overlay (fixes "closes without wanting")
        modal.addEventListener("click", (e) => e.stopPropagation());
        // ESC closes, Enter on Save handled by buttons
        const escHandler = (e) => {
            if (e.key === "Escape") {
                overlay.remove();
                document.removeEventListener("keydown", escHandler);
            }
        };
        document.addEventListener("keydown", escHandler);
        overlay.addEventListener("remove", () => document.removeEventListener("keydown", escHandler));
        // Keep modal stable: don't close on outside mousedown, only click
        overlay.style.cursor = "default";
        modal.style.cursor = "auto";
    }

    // ── Generic Confirm Modal ──────────────────────────────────────────────

    _showConfirmModal(title, message, onConfirm, onCancel) {
        const overlay = document.createElement("div");
        overlay.className = "ca-modal-overlay";

        const modal = document.createElement("div");
        modal.className = "ca-modal";

        const h = document.createElement("h4");
        h.textContent = title;
        modal.appendChild(h);

        const p = document.createElement("p");
        p.style.cssText = "font-size:13px; line-height:1.5; white-space:pre-wrap; margin:8px 0;";
        p.textContent = message;
        modal.appendChild(p);

        const btns = document.createElement("div");
        btns.className = "ca-modal-btns";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "ca-modal-btn cancel";
        cancelBtn.textContent = "Decline";
        cancelBtn.onclick = () => {
            overlay.remove();
            if (onCancel) onCancel();
        };

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "ca-modal-btn confirm";
        confirmBtn.textContent = "Approve";
        confirmBtn.onclick = () => {
            overlay.remove();
            if (onConfirm) onConfirm();
        };

        btns.appendChild(cancelBtn);
        btns.appendChild(confirmBtn);
        modal.appendChild(btns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }
}

// ── Register Extension ────────────────────────────────────────────────────

app.registerExtension({
    name: "ComfyAgent.Extension",
    async setup() {
        new ComfyAgentUI();
        console.log("[ComfyAgent] UI extension loaded.");
    },
});
