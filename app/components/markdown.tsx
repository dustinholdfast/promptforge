"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer — headings, lists, code fences, bold,
 * italic, inline code and rules. Model output is trusted-ish (it is our own
 * prompt talking to our own key) but we still never use dangerouslySetInnerHTML,
 * so nothing in a response can inject markup.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="markdown">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = null;
  };

  for (const line of lines) {
    if (fence) {
      if (line.trimEnd().startsWith("```")) {
        blocks.push(
          <pre key={blocks.length}>
            <code>{fence.lines.join("\n")}</code>
          </pre>,
        );
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      flushList();
      fence = { lang: line.trim().slice(3), lines: [] };
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const content = inline(heading[2]);
      blocks.push(
        level === 1 ? (
          <h2 key={blocks.length}>{content}</h2>
        ) : level === 2 ? (
          <h3 key={blocks.length}>{content}</h3>
        ) : (
          <h4 key={blocks.length}>{content}</h4>
        ),
      );
      continue;
    }

    if (/^\s*([-*])\s+/.test(line)) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+/.exec(line);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(line.replace(/^\s*\d+[.)]\s+/, ""));
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={blocks.length} />);
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }

  flushList();
  if (fence) {
    blocks.push(
      <pre key={blocks.length}>
        <code>{fence.lines.join("\n")}</code>
      </pre>,
    );
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string): ReactNode {
  const parts = text.split(INLINE).filter((part) => part !== "");
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link && /^https?:\/\//.test(link[2])) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener">
              {link[1]}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
