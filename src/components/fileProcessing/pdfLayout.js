import { encode } from "gpt-tokenizer"

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
const CJK_TRAILING_PUNCTUATION_RE = /[，。；：！？、）》】]/u
const CJK_OPENING_PUNCTUATION_RE = /[（《【]/u
const CLOSING_PUNCTUATION_RE = /^[,.;:!?%)\]}，。；：！？、）》】]/u
const OPENING_PUNCTUATION_RE = /[(\[{（《【]$/u

function hasCjkBoundary(previousChar, nextChar) {
  const previousIsCjk = CJK_RE.test(previousChar) || CJK_TRAILING_PUNCTUATION_RE.test(previousChar)
  const nextIsCjk = CJK_RE.test(nextChar) || CJK_OPENING_PUNCTUATION_RE.test(nextChar)
  return previousIsCjk && nextIsCjk
}

function median(values, fallback = 0) {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function normalizeFragment(item) {
  const text = String(item?.str || "")
  if (!text.trim()) return null

  const transform = Array.isArray(item.transform) ? item.transform : []
  const transformHeight = Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0)
  const height = Math.max(1, Math.abs(Number(item.height)) || transformHeight || 10)
  const x = Number(transform[4]) || 0
  const y = Number(transform[5]) || 0
  const width = Math.max(0, Math.abs(Number(item.width)) || 0)

  return {
    text,
    x,
    y,
    width,
    height,
    xEnd: x + width,
    hasEOL: Boolean(item.hasEOL),
  }
}

function needsSpace(previous, next, gap, height) {
  if (!previous || !next) return false
  if (/\s$/u.test(previous) || /^\s/u.test(next)) return false

  const previousChar = Array.from(previous).at(-1)
  const nextChar = Array.from(next)[0]
  if (hasCjkBoundary(previousChar, nextChar)) return false
  if (CLOSING_PUNCTUATION_RE.test(nextChar)) return false
  if (OPENING_PUNCTUATION_RE.test(previousChar)) return false

  return gap > Math.max(0.8, height * 0.08)
}

function buildLine(fragments) {
  const ordered = [...fragments].sort((a, b) => a.x - b.x)
  let text = ""
  let previous = null

  for (const fragment of ordered) {
    const gap = previous ? fragment.x - previous.xEnd : 0
    if (previous && needsSpace(text, fragment.text, gap, Math.max(previous.height, fragment.height))) {
      text += " "
    }
    text += fragment.text
    previous = fragment
  }

  return {
    text: text.replace(/[ \t]+/gu, " ").trim(),
    xMin: Math.min(...ordered.map(fragment => fragment.x)),
    xMax: Math.max(...ordered.map(fragment => fragment.xEnd)),
    y: median(ordered.map(fragment => fragment.y)),
    height: Math.max(...ordered.map(fragment => fragment.height)),
    hasEOL: ordered.some(fragment => fragment.hasEOL),
    column: 0,
  }
}

function groupIntoLines(fragments, pageWidth) {
  const rows = []
  const ordered = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)

  for (const fragment of ordered) {
    const row = rows.find(candidate => (
      Math.abs(candidate.y - fragment.y) <= Math.max(2, Math.min(candidate.height, fragment.height) * 0.45)
    ))

    if (row) {
      row.fragments.push(fragment)
      row.y = median(row.fragments.map(item => item.y))
      row.height = Math.max(row.height, fragment.height)
    } else {
      rows.push({ y: fragment.y, height: fragment.height, fragments: [fragment] })
    }
  }

  const lines = []
  for (const row of rows) {
    const rowFragments = [...row.fragments].sort((a, b) => a.x - b.x)
    const groups = []
    const splitGap = Math.max(24, pageWidth * 0.06, row.height * 3)

    for (const fragment of rowFragments) {
      const group = groups.at(-1)
      const previous = group?.at(-1)
      if (previous && fragment.x - previous.xEnd > splitGap) {
        groups.push([fragment])
      } else if (group) {
        group.push(fragment)
      } else {
        groups.push([fragment])
      }
    }

    groups.forEach(group => lines.push(buildLine(group)))
  }

  return lines.filter(line => line.text)
}

function sortVertical(lines) {
  return [...lines].sort((a, b) => b.y - a.y || a.xMin - b.xMin)
}

function orderForReading(lines, pageWidth) {
  const vertical = sortVertical(lines)
  if (vertical.length < 4 || pageWidth <= 0) return vertical

  const midpoint = pageWidth / 2
  const ordered = []
  let band = []

  const flushBand = () => {
    if (!band.length) return
    const left = band.filter(line => (line.xMin + line.xMax) / 2 < midpoint)
    const right = band.filter(line => (line.xMin + line.xMax) / 2 >= midpoint)

    if (left.length >= 2 && right.length >= 2) {
      sortVertical(left).forEach(line => ordered.push({ ...line, column: 0 }))
      sortVertical(right).forEach(line => ordered.push({ ...line, column: 1 }))
    } else {
      sortVertical(band).forEach(line => ordered.push({ ...line, column: 0 }))
    }
    band = []
  }

  for (const line of vertical) {
    const center = (line.xMin + line.xMax) / 2
    const spansMidpoint = line.xMin < midpoint - pageWidth * 0.12
      && line.xMax > midpoint + pageWidth * 0.12
    const centeredHeading = Math.abs(center - midpoint) < pageWidth * 0.08
      && line.xMax - line.xMin > pageWidth * 0.25

    if (spansMidpoint || centeredHeading) {
      flushBand()
      ordered.push({ ...line, column: -1 })
    } else {
      band.push(line)
    }
  }
  flushBand()

  return ordered
}

function appendLine(previousText, nextText) {
  if (!previousText) return nextText
  if (/\p{L}-$/u.test(previousText) && /^[a-z]/u.test(nextText)) {
    return previousText.slice(0, -1) + nextText
  }

  const previousChar = Array.from(previousText).at(-1)
  const nextChar = Array.from(nextText)[0]
  if (hasCjkBoundary(previousChar, nextChar)) {
    return previousText + nextText
  }
  return `${previousText} ${nextText}`
}

function shouldStartParagraph(previous, current, medianHeight) {
  if (!previous || previous.column !== current.column) return true

  const referenceHeight = Math.max(previous.height, current.height, medianHeight)
  const verticalGap = previous.y - current.y
  const headingChanged = previous.height > medianHeight * 1.3
    || current.height > medianHeight * 1.3
  const indented = Math.abs(previous.xMin - current.xMin) > referenceHeight * 1.4
  const previousEndsSentence = /[.!?。！？；;:：]$/u.test(previous.text)

  return verticalGap > referenceHeight * 1.65
    || headingChanged
    || (indented && previousEndsSentence)
}

export function reconstructPageText(items, pageWidth) {
  const fragments = (items || []).map(normalizeFragment).filter(Boolean)
  if (!fragments.length) {
    return { text: "", lines: [], paragraphs: [], medianFontSize: 11 }
  }

  const lines = orderForReading(groupIntoLines(fragments, pageWidth), pageWidth)
  const medianFontSize = median(lines.map(line => line.height), 11)
  const paragraphs = []
  let currentParagraph = null
  let previousLine = null

  for (const line of lines) {
    if (shouldStartParagraph(previousLine, line, medianFontSize)) {
      currentParagraph = {
        text: line.text,
        fontSize: line.height,
        column: line.column,
      }
      paragraphs.push(currentParagraph)
    } else {
      currentParagraph.text = appendLine(currentParagraph.text, line.text)
      currentParagraph.fontSize = Math.max(currentParagraph.fontSize, line.height)
    }
    previousLine = line
  }

  return {
    text: paragraphs.map(paragraph => paragraph.text).join("\n\n"),
    lines,
    paragraphs,
    medianFontSize,
  }
}

function naturalJoin(left, right) {
  if (!left) return right
  const leftChar = Array.from(left).at(-1)
  const rightChar = Array.from(right)[0]
  if (hasCjkBoundary(leftChar, rightChar)) return left + right
  return `${left} ${right}`
}

function splitOversizedText(text, maxTokens) {
  const hasWhitespace = /\s/u.test(text)
  const units = hasWhitespace ? (text.match(/\S+\s*/gu) || [text]) : Array.from(text)
  const pieces = []
  let current = ""

  const pushCurrent = () => {
    const value = current.trim()
    if (value) pieces.push(value)
    current = ""
  }

  for (const unit of units) {
    if (encode(unit).length > maxTokens) {
      pushCurrent()
      let graphemeBuffer = ""
      for (const grapheme of Array.from(unit)) {
        const candidate = graphemeBuffer + grapheme
        if (graphemeBuffer && encode(candidate).length > maxTokens) {
          pieces.push(graphemeBuffer)
          graphemeBuffer = grapheme
        } else {
          graphemeBuffer = candidate
        }
      }
      if (graphemeBuffer.trim()) pieces.push(graphemeBuffer.trim())
      continue
    }

    const candidate = current + unit
    if (current && encode(candidate).length > maxTokens) {
      pushCurrent()
      current = unit
    } else {
      current = candidate
    }
  }
  pushCurrent()
  return pieces
}

function splitSentences(paragraph) {
  return paragraph.match(/[^.!?。！？；;\n]+(?:[.!?。！？；;]+|$)/gu)
    ?.map(sentence => sentence.trim())
    .filter(Boolean) || [paragraph]
}

export function chunkText(text, maxTokens) {
  const normalized = String(text || "").replace(/\r\n?/gu, "\n").trim()
  if (!normalized) return []

  const chunks = []
  let current = ""

  const pushCurrent = () => {
    if (current) chunks.push(current)
    current = ""
  }

  const appendPiece = (piece, paragraphBreak = false) => {
    if (encode(piece).length > maxTokens) {
      pushCurrent()
      chunks.push(...splitOversizedText(piece, maxTokens))
      return
    }

    const candidate = current
      ? (paragraphBreak ? `${current}\n\n${piece}` : naturalJoin(current, piece))
      : piece
    if (current && encode(candidate).length > maxTokens) {
      pushCurrent()
      current = piece
    } else {
      current = candidate
    }
  }

  const paragraphs = normalized.split(/\n{2,}/gu).map(value => value.trim()).filter(Boolean)
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = splitSentences(paragraph)
    sentences.forEach((sentence, sentenceIndex) => {
      appendPiece(sentence, paragraphIndex > 0 && sentenceIndex === 0)
    })
  })
  pushCurrent()

  return chunks
}

export function sanitizeForFont(font, text) {
  if (!font || typeof font.encodeText !== "function") return text
  const safe = []
  for (const character of Array.from(String(text || ""))) {
    try {
      font.encodeText(character)
      safe.push(character)
    } catch {
      safe.push("?")
    }
  }
  return safe.join("")
}

function wordSegments(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" })
    return Array.from(segmenter.segment(text), entry => entry.segment)
  }
  return Array.from(text)
}

function wrapSingleLine(text, fontSize, font, maxWidth) {
  const output = []
  let current = ""

  const widthOf = value => font.widthOfTextAtSize(sanitizeForFont(font, value), fontSize)
  const pushCurrent = () => {
    const value = current.trimEnd()
    if (value) output.push(sanitizeForFont(font, value))
    current = ""
  }

  const appendByGrapheme = (segment) => {
    for (const grapheme of Array.from(segment.trimStart())) {
      const candidate = current + grapheme
      if (current && widthOf(candidate) > maxWidth) {
        pushCurrent()
        current = grapheme
      } else {
        current = candidate
      }
    }
  }

  for (const segment of wordSegments(text)) {
    const candidate = current + segment
    if (widthOf(candidate) <= maxWidth) {
      current = candidate
      continue
    }

    if (current.trim()) pushCurrent()
    const trimmedSegment = segment.trimStart()
    if (!trimmedSegment) continue

    if (widthOf(trimmedSegment) <= maxWidth) {
      current = trimmedSegment
    } else {
      appendByGrapheme(trimmedSegment)
    }
  }
  pushCurrent()

  return output
}

export function wrapText(text, fontSize, font, maxWidth) {
  const lines = []
  const explicitLines = String(text || "").replace(/\r\n?/gu, "\n").split("\n")

  explicitLines.forEach((line) => {
    if (!line.trim()) {
      if (lines.at(-1) !== "") lines.push("")
      return
    }
    lines.push(...wrapSingleLine(line, fontSize, font, maxWidth))
  })

  while (lines.at(-1) === "") lines.pop()
  return lines
}
