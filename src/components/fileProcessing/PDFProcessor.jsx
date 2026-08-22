import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { PDFDocument } from "pdf-lib"
import defaultUnicodeFontUrl from "../assets/fonts/NotoSansSC-VF.ttf?url"
import { generateTermTable } from "./termTable"
import translateGlossary from "./GlossaryTranslator"
import { chunkText, reconstructPageText, sanitizeForFont, wrapText } from "./pdfLayout"
import LLM_Request from "../LLM/LLM_Request"

const MAX_TOKENS = 2000
const HEADER_SIZE = 9
const MIN_FONT_SIZE = 9
const MAX_FONT_SIZE = 12

GlobalWorkerOptions.workerSrc = workerSrc

export default async function PDFProcessor(file, options = {}) {
  const {
    sourceLang = "en",
    targetLang = "zh",
    apiKey = "",
    bookTitle = "",
    author = "",
    domain = "",
    model = "deepseek-chat",
    glossaryOnly = false,
    overrideGlossary = null,
    useGlossary = true,
    onProgress = undefined,
    fontUrl = null,
  } = options

  const arrayBuffer = await file.arrayBuffer()
  const pdfJsBytes = arrayBuffer.slice(0)
  const pdfLibBytes = arrayBuffer.slice(0)

  const pdf = await getDocument({ data: pdfJsBytes }).promise
  const pageTexts = []
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const layout = reconstructPageText(textContent.items, viewport.width)

    pageTexts.push({
      index,
      text: layout.text,
      width: viewport.width,
      height: viewport.height,
      medianFontSize: layout.medianFontSize,
    })
    page.cleanup()
  }
  await pdf.destroy()

  let termTable = []
  if (useGlossary) {
    if (Array.isArray(overrideGlossary)) {
      termTable = overrideGlossary
        .filter(item => item?.term)
        .map(item => ({ term: item.term, translation: item.translation || "" }))
    } else {
      const fullPlainText = pageTexts.map(page => page.text).filter(Boolean).join("\n\n")
      const rawTable = await generateTermTable(fullPlainText, {
        topN: 150,
        minFreq: 3,
        language: sourceLang,
      })
      const glossary = await translateGlossary(rawTable, {
        sourceLang,
        targetLang,
        apiKey,
        bookTitle,
        author,
        domain,
        model,
      })
      termTable = glossary.simpleGlossary

      if (glossaryOnly) {
        return { detailedGlossary: glossary.detailedGlossary }
      }
    }
  }

  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfLibBytes))
  const font = await loadFont(pdfDoc, fontUrl)
  const perPageSegments = pageTexts.map(page => ({
    ...page,
    segments: chunkText(page.text, MAX_TOKENS),
  }))
  const totalChunks = perPageSegments.reduce((sum, page) => sum + page.segments.length, 0)
  let completedChunks = 0

  const translatedPages = []
  for (const page of perPageSegments) {
    const translatedSegments = []
    let context = ""

    for (const segment of page.segments) {
      const translated = await LLM_Request(
        [segment],
        termTable,
        "text",
        context,
        { sourceLang, targetLang, apiKey, bookTitle, author, domain, model },
      )
      const translatedText = Array.isArray(translated)
        ? translated.join("\n")
        : String(translated || segment)

      translatedSegments.push(translatedText)
      context = segment.slice(-4000)
      completedChunks += 1
      onProgress?.(completedChunks, totalChunks)
    }

    translatedPages.push({
      ...page,
      translated: translatedSegments.join("\n\n"),
    })
  }

  let insertedPages = 0

  for (const translatedPage of translatedPages) {
    if (!translatedPage.translated.trim()) continue

    const originalPagePosition = translatedPage.index - 1 + insertedPages
    const insertAt = originalPagePosition + 1
    insertedPages += insertTranslationPages(pdfDoc, insertAt, translatedPage, font)
  }

  const pdfBytes = await pdfDoc.save()
  triggerDownload(pdfBytes, file.name.replace(/\.[^.]+$/u, "") + "_translated.pdf")
}

async function loadFont(pdfDoc, customFontUrl) {
  const fontkitModule = await import("@pdf-lib/fontkit")
  pdfDoc.registerFontkit(fontkitModule.default || fontkitModule)

  const fontUrls = [...new Set([customFontUrl, defaultUnicodeFontUrl].filter(Boolean))]
  let lastError = null

  for (const fontUrl of fontUrls) {
    try {
      const response = await fetch(fontUrl)
      if (!response.ok) {
        throw new Error(`Font request failed with status ${response.status}`)
      }
      const fontBytes = await response.arrayBuffer()
      return await pdfDoc.embedFont(new Uint8Array(fontBytes), { subset: true })
    } catch (error) {
      lastError = error
      console.warn(`Unable to load PDF font from ${fontUrl}`, error)
    }
  }

  throw new Error("Unable to load the bundled Unicode PDF font", { cause: lastError })
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function insertTranslationPages(pdfDoc, initialIndex, translatedPage, font) {
  const { index: sourcePage, width, height, translated, medianFontSize } = translatedPage
  const margin = clamp(width * 0.07, 28, 54)
  const textWidth = Math.max(40, width - margin * 2)
  const fontSize = clamp(medianFontSize || 11, MIN_FONT_SIZE, MAX_FONT_SIZE)
  const lineHeight = fontSize * 1.55
  const lines = wrapText(translated, fontSize, font, textWidth)
  let insertIndex = initialIndex
  let continuation = 1
  let page
  let cursorY

  const createPage = () => {
    page = pdfDoc.insertPage(insertIndex, [width, height])
    insertIndex += 1

    const continuationLabel = continuation > 1 ? ` (${continuation})` : ""
    const header = sanitizeForFont(font, `Page ${sourcePage} Translation${continuationLabel}`)
    const headerY = height - margin + 4
    page.drawText(header, { x: margin, y: headerY, size: HEADER_SIZE, font })
    page.drawLine({
      start: { x: margin, y: headerY - 7 },
      end: { x: width - margin, y: headerY - 7 },
      thickness: 0.5,
      opacity: 0.35,
    })
    cursorY = headerY - HEADER_SIZE - 14
    continuation += 1
  }

  createPage()
  for (const line of lines) {
    const requiredHeight = line === "" ? lineHeight * 0.55 : lineHeight
    if (cursorY - requiredHeight < margin) {
      createPage()
    }

    if (line) {
      page.drawText(line, {
        x: margin,
        y: cursorY,
        size: fontSize,
        font,
      })
    }
    cursorY -= requiredHeight
  }

  return insertIndex - initialIndex
}

function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
