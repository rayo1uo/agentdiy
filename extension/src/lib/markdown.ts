const escapeHTML = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sanitizeURL = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
};

const applyInlineMarkdown = (input: string): string => {
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    const token = `\u0000MD_${placeholders.length}_\u0000`;
    placeholders.push(html);
    return token;
  };

  let source = input;
  source = source.replace(/`([^`\n]+)`/g, (_match, code: string) => stash(`<code>${escapeHTML(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, src: string) => {
    const safe = sanitizeURL(src);
    if (!safe) {
      return match;
    }
    return stash(`<img src="${escapeHTML(safe)}" alt="${escapeHTML(alt)}" loading="lazy">`);
  });
  source = source.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = sanitizeURL(href);
    if (!safe) {
      return match;
    }
    return stash(
      `<a href="${escapeHTML(safe)}" target="_blank" rel="noreferrer noopener">${escapeHTML(label)}</a>`
    );
  });

  let escaped = escapeHTML(source);
  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  placeholders.forEach((html, index) => {
    const token = `\u0000MD_${index}_\u0000`;
    escaped = escaped.split(token).join(html);
  });
  return escaped;
};

const closeParagraph = (buffer: string[], parts: string[]): void => {
  if (buffer.length === 0) {
    return;
  }
  const html = buffer.map((line) => applyInlineMarkdown(line)).join("<br>");
  parts.push(`<p>${html}</p>`);
  buffer.length = 0;
};

const closeList = (listType: "ul" | "ol" | null, items: string[], parts: string[]): "ul" | "ol" | null => {
  if (!listType || items.length === 0) {
    items.length = 0;
    return null;
  }
  parts.push(`<${listType}>${items.join("")}</${listType}>`);
  items.length = 0;
  return null;
};

const closeBlockquote = (quoteLines: string[], parts: string[]): void => {
  if (quoteLines.length === 0) {
    return;
  }
  const html = quoteLines.map((line) => `<p>${applyInlineMarkdown(line)}</p>`).join("");
  parts.push(`<blockquote>${html}</blockquote>`);
  quoteLines.length = 0;
};

export const markdownToHTML = (markdown: string): string => {
  const source = markdown.replace(/\r\n?/g, "\n");
  if (!source.trim()) {
    return "";
  }

  const lines = source.split("\n");
  const parts: string[] = [];
  const paragraphBuffer: string[] = [];
  const quoteLines: string[] = [];
  const listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inFence = false;
  const fenceLines: string[] = [];

  const flushTextBlocks = (): void => {
    closeParagraph(paragraphBuffer, parts);
    closeBlockquote(quoteLines, parts);
    listType = closeList(listType, listItems, parts);
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";

    if (inFence) {
      if (/^\s*```/.test(line)) {
        parts.push(`<pre><code>${escapeHTML(fenceLines.join("\n"))}</code></pre>`);
        fenceLines.length = 0;
        inFence = false;
      } else {
        fenceLines.push(line);
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushTextBlocks();
      inFence = true;
      continue;
    }

    if (!line.trim()) {
      flushTextBlocks();
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushTextBlocks();
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${applyInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      closeParagraph(paragraphBuffer, parts);
      listType = closeList(listType, listItems, parts);
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    if (quoteLines.length > 0) {
      closeBlockquote(quoteLines, parts);
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      closeParagraph(paragraphBuffer, parts);
      if (listType && listType !== "ul") {
        listType = closeList(listType, listItems, parts);
      }
      listType = "ul";
      listItems.push(`<li>${applyInlineMarkdown(unorderedMatch[1].trim())}</li>`);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      closeParagraph(paragraphBuffer, parts);
      if (listType && listType !== "ol") {
        listType = closeList(listType, listItems, parts);
      }
      listType = "ol";
      listItems.push(`<li>${applyInlineMarkdown(orderedMatch[1].trim())}</li>`);
      continue;
    }

    if (listType) {
      listType = closeList(listType, listItems, parts);
    }
    paragraphBuffer.push(line.trim());
  }

  if (inFence) {
    parts.push(`<pre><code>${escapeHTML(fenceLines.join("\n"))}</code></pre>`);
  }
  closeParagraph(paragraphBuffer, parts);
  closeBlockquote(quoteLines, parts);
  closeList(listType, listItems, parts);

  return parts.join("");
};
