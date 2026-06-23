/**
 * 把 Markdown 文本转成真正的 .docx（Word）文件。
 * 支持：标题(#~######)、段落、加粗/斜体、行内代码、有序/无序列表(含一层嵌套)、
 *      表格(GFM)、代码块、引用、分隔线。
 * 仅在浏览器端点击「下载 Word」时被动态加载，避免增大首屏体积。
 */
import { marked } from "marked";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

type AnyToken = Record<string, any>;
type Opts = { bold: boolean; italics: boolean };

function headingLevel(depth: number) {
  switch (Math.min(Math.max(depth, 1), 6)) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

// 行内标记 → TextRun[]
function inlineRuns(
  tokens: AnyToken[] | undefined,
  opts: Opts = { bold: false, italics: false }
): TextRun[] {
  const runs: TextRun[] = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case "strong":
        runs.push(...inlineRuns(t.tokens, { ...opts, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(t.tokens, { ...opts, italics: true }));
        break;
      case "codespan":
        runs.push(
          new TextRun({ text: t.text, font: "Consolas", bold: opts.bold, italics: opts.italics })
        );
        break;
      case "br":
        runs.push(new TextRun({ break: 1 }));
        break;
      case "del":
      case "link":
        runs.push(
          ...inlineRuns(t.tokens || [{ type: "text", text: t.text }], opts)
        );
        break;
      case "text":
        if (t.tokens && t.tokens.length) runs.push(...inlineRuns(t.tokens, opts));
        else runs.push(new TextRun({ text: t.text, bold: opts.bold, italics: opts.italics }));
        break;
      default:
        if (t.text)
          runs.push(new TextRun({ text: t.text, bold: opts.bold, italics: opts.italics }));
    }
  }
  return runs;
}

const thin = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };

function buildTable(tok: AnyToken): Table {
  const rows: TableRow[] = [];
  rows.push(
    new TableRow({
      tableHeader: true,
      children: (tok.header as AnyToken[]).map(
        (c) =>
          new TableCell({
            shading: { fill: "F0F4FA" },
            children: [new Paragraph({ children: inlineRuns(c.tokens, { bold: true, italics: false }) })],
          })
      ),
    })
  );
  for (const r of tok.rows as AnyToken[][]) {
    rows.push(
      new TableRow({
        children: r.map(
          (c) => new TableCell({ children: [new Paragraph({ children: inlineRuns(c.tokens) })] })
        ),
      })
    );
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: {
      top: thin,
      bottom: thin,
      left: thin,
      right: thin,
      insideHorizontal: thin,
      insideVertical: thin,
    },
  });
}

function itemInline(item: AnyToken): { inline: TextRun[]; nested: AnyToken[] } {
  const inline: TextRun[] = [];
  const nested: AnyToken[] = [];
  for (const it of item.tokens || []) {
    if (it.type === "list") nested.push(it);
    else if (it.type === "text")
      inline.push(...inlineRuns(it.tokens && it.tokens.length ? it.tokens : [{ type: "text", text: it.text }]));
    else inline.push(...inlineRuns([it]));
  }
  return { inline, nested };
}

function blocksFromTokens(tokens: AnyToken[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "heading":
        out.push(
          new Paragraph({
            heading: headingLevel(tok.depth),
            spacing: { before: 200, after: 80 },
            children: inlineRuns(tok.tokens),
          })
        );
        break;
      case "paragraph":
        out.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns(tok.tokens) }));
        break;
      case "list":
        (tok.items as AnyToken[]).forEach((item, idx) => {
          const { inline, nested } = itemInline(item);
          if (tok.ordered) {
            out.push(
              new Paragraph({
                spacing: { after: 40 },
                indent: { left: 360 },
                children: [new TextRun({ text: `${(tok.start || 1) + idx}. ` }), ...inline],
              })
            );
          } else {
            out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inline }));
          }
          for (const n of nested) {
            (n.items as AnyToken[]).forEach((sub) => {
              const { inline: subInline } = itemInline(sub);
              out.push(new Paragraph({ bullet: { level: 1 }, spacing: { after: 40 }, children: subInline }));
            });
          }
        });
        break;
      case "table":
        out.push(buildTable(tok));
        out.push(new Paragraph({ text: "", spacing: { after: 80 } }));
        break;
      case "code":
        for (const line of String(tok.text).split("\n")) {
          out.push(new Paragraph({ children: [new TextRun({ text: line, font: "Consolas", size: 20 })] }));
        }
        break;
      case "blockquote":
        for (const b of blocksFromTokens(tok.tokens || [])) out.push(b);
        break;
      case "hr":
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
            spacing: { after: 120 },
          })
        );
        break;
      case "space":
        break;
      default:
        if (tok.text) out.push(new Paragraph({ children: [new TextRun(String(tok.text))] }));
    }
  }
  return out;
}

export async function markdownToDocxBlob(
  markdown: string,
  title = "小学数学教学设计诊断报告"
): Promise<Blob> {
  const tokens = marked.lexer(markdown) as AnyToken[];
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
      children: [new TextRun({ text: title })],
    }),
    ...blocksFromTokens(tokens),
  ];
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "宋体", size: 24 } }, // 正文 12pt
      },
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
