/**
 * PaperKnife - PDF to Markdown conversion with formatting preservation.
 * Uses pdf.js text layer metadata (font size, weight, position) to emit Markdown
 * that mirrors the original document structure.
 */

type PdfPage = {
  getTextContent: () => Promise<TextContent>
}

type TextContent = {
  items: TextContentItem[]
  styles: Record<string, { fontFamily?: string }>
}

type TextContentItem = {
  str?: string
  transform?: number[]
  fontName?: string
  width?: number
  height?: number
  hasEOL?: boolean
}

type StyledRun = {
  text: string
  x: number
  y: number
  fontSize: number
  bold: boolean
  italic: boolean
  monospace: boolean
}

type LineBlock = {
  runs: StyledRun[]
  y: number
  fontSize: number
}

type HeadingThresholds = {
  h1: number
  h2: number
  h3: number
  body: number
}

const LINE_Y_TOLERANCE = 3
const PARAGRAPH_GAP_RATIO = 1.6

function parseFontFlags(fontName: string, fontFamily = ''): Pick<StyledRun, 'bold' | 'italic' | 'monospace'> {
  const name = `${fontName} ${fontFamily}`.toLowerCase()
  return {
    bold: /\b(bold|black|heavy|semibold|demi|extrabold)\b/.test(name),
    italic: /\b(italic|oblique)\b/.test(name),
    monospace: /\b(mono|courier|consolas|typewriter|code)\b/.test(name),
  }
}

function fontSizeFromTransform(transform: number[]): number {
  const scaleX = Math.hypot(transform[0] ?? 0, transform[1] ?? 0)
  const scaleY = Math.hypot(transform[2] ?? 0, transform[3] ?? 0)
  return Math.max(scaleX, scaleY, 1)
}

function extractRuns(items: TextContentItem[], styles: TextContent['styles']): StyledRun[] {
  const runs: StyledRun[] = []

  for (const item of items) {
    if (!item.str || !item.transform || item.transform.length < 6) continue

    const fontName = item.fontName ?? ''
    const style = styles[fontName]
    const flags = parseFontFlags(fontName, style?.fontFamily ?? '')

    runs.push({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      fontSize: fontSizeFromTransform(item.transform),
      ...flags,
    })
  }

  return runs
}

function dominantFontSize(runs: StyledRun[]): number {
  if (!runs.length) return 12
  const total = runs.reduce((sum, run) => sum + run.fontSize * Math.max(run.text.length, 1), 0)
  const chars = runs.reduce((sum, run) => sum + Math.max(run.text.length, 1), 0)
  return total / chars
}

function groupIntoLines(runs: StyledRun[]): LineBlock[] {
  if (!runs.length) return []

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: LineBlock[] = []
  let currentRuns: StyledRun[] = [sorted[0]]
  let currentY = sorted[0].y

  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i]
    if (Math.abs(run.y - currentY) <= LINE_Y_TOLERANCE) {
      currentRuns.push(run)
    } else {
      currentRuns.sort((a, b) => a.x - b.x)
      lines.push({ runs: currentRuns, y: currentY, fontSize: dominantFontSize(currentRuns) })
      currentRuns = [run]
      currentY = run.y
    }
  }

  currentRuns.sort((a, b) => a.x - b.x)
  lines.push({ runs: currentRuns, y: currentY, fontSize: dominantFontSize(currentRuns) })

  return lines
}

function computeHeadingThresholds(allSizes: number[]): HeadingThresholds {
  if (!allSizes.length) {
    return { body: 12, h3: 14, h2: 16, h1: 20 }
  }

  const sorted = [...allSizes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p75 = sorted[Math.floor(sorted.length * 0.75)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]

  return {
    body: median,
    h3: Math.max(median * 1.12, p75 * 0.95),
    h2: Math.max(median * 1.25, p75),
    h1: Math.max(median * 1.45, p90),
  }
}

function applyInlineFormatting(run: StyledRun): string {
  const raw = run.text
  if (!raw.trim()) return raw

  if (run.monospace) {
    return `\`${raw.replace(/`/g, '\\`')}\``
  }

  if (run.bold && run.italic) return `***${raw}***`
  if (run.bold) return `**${raw}**`
  if (run.italic) return `*${raw}*`
  return raw
}

function runsToLineText(runs: StyledRun[]): string {
  if (!runs.length) return ''

  let line = ''
  let prevEndX = 0

  for (const run of runs) {
    if (line && prevEndX > 0 && run.x - prevEndX > run.fontSize * 0.35) {
      line += ' '
    }
    line += applyInlineFormatting(run)
    prevEndX = run.x + run.text.length * run.fontSize * 0.45
  }

  return line.trim()
}

function formatListLine(line: string): string {
  const bullet = line.match(/^([•●○◦▪▸\-*+])\s+(.*)$/)
  if (bullet) return `- ${bullet[2]}`

  const numbered = line.match(/^(\d+)[.)]\s+(.*)$/)
  if (numbered) return `${numbered[1]}. ${numbered[2]}`

  return line
}

function applyHeading(line: string, fontSize: number, thresholds: HeadingThresholds): string {
  if (!line.trim()) return line
  if (fontSize >= thresholds.h1) return `# ${line}`
  if (fontSize >= thresholds.h2) return `## ${line}`
  if (fontSize >= thresholds.h3) return `### ${line}`
  return line
}

function linesToMarkdown(lines: LineBlock[], thresholds: HeadingThresholds): string {
  if (!lines.length) return ''

  const avgLineHeight =
    lines.reduce((sum, line, index, arr) => {
      if (index === 0) return sum
      return sum + Math.abs(arr[index - 1].y - line.y)
    }, 0) / Math.max(lines.length - 1, 1)

  const parts: string[] = []
  let previousY = lines[0].y

  for (let i = 0; i < lines.length; i++) {
    const block = lines[i]
    const rawLine = runsToLineText(block.runs)
    if (!rawLine) continue

    if (i > 0) {
      const gap = Math.abs(previousY - block.y)
      if (gap > avgLineHeight * PARAGRAPH_GAP_RATIO) {
        parts.push('')
      }
    }

    let formatted = formatListLine(rawLine)
    formatted = applyHeading(formatted, block.fontSize, thresholds)
    parts.push(formatted)
    previousY = block.y
  }

  return parts.join('\n')
}

export async function convertPdfToMarkdown(
  pdfDoc: { numPages: number; getPage: (num: number) => Promise<PdfPage> },
  onProgress?: (percent: number) => void
): Promise<string> {
  const allSizes: number[] = []
  const pageContents: { pageNum: number; lines: LineBlock[] }[] = []

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const textContent = await page.getTextContent()
    const runs = extractRuns(textContent.items, textContent.styles)
    runs.forEach(run => allSizes.push(run.fontSize))
    pageContents.push({ pageNum, lines: groupIntoLines(runs) })
    onProgress?.(Math.round((pageNum / pdfDoc.numPages) * 50))
  }

  const thresholds = computeHeadingThresholds(allSizes)
  const pageMarkdown: string[] = []

  for (const { pageNum, lines } of pageContents) {
    const markdown = linesToMarkdown(lines, thresholds)
    if (markdown.trim()) {
      if (pdfDoc.numPages > 1) {
        pageMarkdown.push(`<!-- Page ${pageNum} -->\n\n${markdown}`)
      } else {
        pageMarkdown.push(markdown)
      }
    }
    onProgress?.(50 + Math.round((pageNum / pdfDoc.numPages) * 50))
  }

  return pageMarkdown.join('\n\n').trim()
}

export function markdownToBytes(markdown: string): Uint8Array {
  return new TextEncoder().encode(markdown)
}
