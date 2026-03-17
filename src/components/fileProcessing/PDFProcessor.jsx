import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { encode } from "gpt-tokenizer"
import { generateTermTable } from "./termTable"
import translateGlossary from "./GlossaryTranslator"
import LLM_Request from "../LLM/LLM_Request"

const MAX_TOKENS = 2000
const LINE_HEIGHT = 18
const FONT_SIZE = 14
const HEADER_SIZE = 10

// 配置 pdf.js worker（使用 Vite 资源 URL）
GlobalWorkerOptions.workerSrc = workerSrc

export default async function PDFProcessor(file, options = {}) {
  const { sourceLang = "en", targetLang = "zh", apiKey = "", bookTitle = "", author = "", domain = "", model = "deepseek-chat", glossaryOnly = false, overrideGlossary = null, useGlossary = true, onProgress = undefined, fontUrl = null } = options

  const arrayBuffer = await file.arrayBuffer()
  // 为 pdf.js 和 pdf-lib 分别准备独立的副本，防止其中一个传输后导致另一份被 detach
  const pdfJsBytes = arrayBuffer.slice(0)
  const pdfLibBytes = arrayBuffer.slice(0)

  // 1) 提取纯文本（按页）
  const pdf = await getDocument({ data: pdfJsBytes }).promise
  const pages = pdf.numPages
  const pageTexts = []
  for (let i = 1; i <= pages; i += 1) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items.map((item) => item.str).join(" ").trim()
    if (pageText.length > 0) {
      pageTexts.push({ index: i, text: pageText })
    } else {
      pageTexts.push({ index: i, text: "" })
    }
  }

  // 2) 生成术语表
  let termTable = []
  if (useGlossary) {
    const fullPlainText = pageTexts.map(p => p.text).join("\n")
    let rawTable = await generateTermTable(fullPlainText, { topN: 150, minFreq: 3, language: sourceLang })
    const glossary = await translateGlossary(rawTable, { sourceLang, targetLang, apiKey, bookTitle, author, domain, model })
    let translationGlossary = glossary.simpleGlossary
    if (overrideGlossary && Array.isArray(overrideGlossary) && overrideGlossary.length > 0) {
      translationGlossary = overrideGlossary.map(item => ({ term: item.term, translation: item.translation || "" }))
      console.log("using user-edited glossary for PDF:", translationGlossary)
    }
    termTable = translationGlossary
    if (glossaryOnly) {
      return { detailedGlossary: glossary.detailedGlossary }
    }
  } else {
    console.log("Skipping glossary generation for PDF as requested")
  }

  // 3) 计算总 chunk 数量，并提前切分
  const perPageSegments = pageTexts.map(p => ({
    index: p.index,
    segments: chunkText(p.text, MAX_TOKENS)
  }))
  const totalChunks = perPageSegments.reduce((sum, p) => sum + p.segments.length, 0)
  let completedChunks = 0

  // 4) 翻译（按切好的分段）
  const translatedPages = []
  for (const page of perPageSegments) {
    const translatedSegments = []
    for (const segment of page.segments) {
      const translated = await LLM_Request([segment], termTable, "text", "", { sourceLang, targetLang, apiKey, bookTitle, author, domain, model }).catch((err) => {
        console.warn("PDF translation failed, fallback to source", err)
        return [segment]
      })
      translatedSegments.push(Array.isArray(translated) ? translated.join("\n") : translated)
      completedChunks += 1
      if (onProgress && totalChunks > 0) {
        onProgress(completedChunks, totalChunks)
      }
    }

    translatedPages.push({
      index: page.index,
      translated: translatedSegments.join("\n\n")
    })
  }

  // 5) 生成新 PDF：保留原页面，附加译文页，图片等元素保持原样
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfLibBytes))
  const font = await loadFont(pdfDoc, fontUrl)
  translatedPages.forEach(({ index, translated }) => {
    const basePage = pdfDoc.getPage(index - 1) || pdfDoc.getPage(0)
    const { width, height } = basePage.getSize()
    let page = pdfDoc.addPage([width, height])
    const margin = 40
    const textWidth = width - margin * 2
    const wrapped = wrapText(translated, FONT_SIZE, font, textWidth)
    let cursorY = height - margin - HEADER_SIZE - 4

    const drawHeader = () => {
      page.drawText(`Page ${index} Translation`, { x: margin, y: height - margin + 6, size: HEADER_SIZE, font })
    }

    drawHeader()
    page.setFont(font)
    page.setFontSize(FONT_SIZE)

    wrapped.forEach(line => {
      if (cursorY < margin) {
        page = pdfDoc.addPage([width, height])
        drawHeader()
        page.setFont(font)
        page.setFontSize(FONT_SIZE)
        cursorY = height - margin - HEADER_SIZE - 4
      }
      if (line !== "") {
        page.drawText(line, { x: margin, y: cursorY })
      }
      cursorY -= LINE_HEIGHT
    })
  })

  const pdfBytes = await pdfDoc.save()
  triggerDownload(pdfBytes, file.name.replace(/\.[^.]+$/, "") + "_translated.pdf")
}

function chunkText(text, maxTokens) {
  const sentences = []
  const regex = /[^\\n\\.\\?!。！？；;]+[\\.\\?!。！？；;]?/g
  const matches = text.match(regex)
  if (matches) {
    matches.forEach((m) => {
      const s = m.trim()
      if (s) sentences.push(s)
    })
  }
  if (sentences.length === 0 && text) {
    sentences.push(text.trim())
  }

  const segments = []
  let buffer = []
  let tokenCount = 0

  const flushBuffer = () => {
    if (buffer.length) {
      segments.push(buffer.join(" "))
      buffer = []
      tokenCount = 0
    }
  }

  const pushLongWord = (word) => segments.push(word)

  for (const sentence of sentences) {
    const sentTokens = encode(sentence).length
    if (sentTokens > maxTokens) {
      flushBuffer()
      const words = sentence.split(/\s+/).filter(Boolean)
      let wbuf = []
      let wcount = 0
      for (const word of words) {
        const wTokens = encode(word).length
        if (wTokens > maxTokens) {
          pushLongWord(word)
          continue
        }
        if (wcount + wTokens > maxTokens && wbuf.length) {
          segments.push(wbuf.join(" "))
          wbuf = []
          wcount = 0
        }
        wbuf.push(word)
        wcount += wTokens
      }
      if (wbuf.length) segments.push(wbuf.join(" "))
      continue
    }

    if (tokenCount + sentTokens > maxTokens && buffer.length) {
      flushBuffer()
    }
    buffer.push(sentence)
    tokenCount += sentTokens
  }

  flushBuffer()
  if (segments.length === 0) {
    segments.push(text || "")
  }
  return segments
}

async function loadFont(pdfDoc, fontUrl) {
  // 优先加载用户提供的 Unicode 字体，以避免 CJK 被替换为 '?'
  if (fontUrl) {
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default
      pdfDoc.registerFontkit(fontkit)
      const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer())
      return await pdfDoc.embedFont(new Uint8Array(fontBytes))
    } catch (err) {
      console.warn("Custom font load failed, fallback to built-in fonts", err)
    }
  }

  // 兜底：仍用内置字体，非拉丁字符会被 '?' 代替
  try {
    return await pdfDoc.embedFont(StandardFonts.Helvetica)
  } catch (err) {
    console.warn("Fallback font load failed, cannot embed Helvetica", err)
    return pdfDoc.embedFont(StandardFonts.Courier)
  }
}

function sanitizeForFont(font, text) {
  if (!font || typeof font.encodeText !== "function") return text
  const chars = Array.from(text)
  const safe = []
  for (const ch of chars) {
    try {
      font.encodeText(ch)
      safe.push(ch)
    } catch (e) {
      safe.push("?")
    }
  }
  return safe.join("")
}

function wrapText(text, fontSize, font, maxWidth) {
  const lines = []
  const paragraphs = text.split(/\n+/)
  paragraphs.forEach(p => {
    if (!p) {
      lines.push("")
      return
    }
    const words = p.split(/\s+/)
    let current = ""
    words.forEach(word => {
      const testLine = current ? `${current} ${word}` : word
      const safeLine = sanitizeForFont(font, testLine)
      const width = font.widthOfTextAtSize(safeLine, fontSize)
      if (width > maxWidth && current) {
        lines.push(sanitizeForFont(font, current))
        current = word
      } else {
        current = testLine
      }
    })
    if (current) lines.push(sanitizeForFont(font, current))
    lines.push("")
  })
  return lines
}

function triggerDownload(bytes, filename){
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
