import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import fontkit from "@pdf-lib/fontkit"
import { PDFDocument } from "pdf-lib"
import { chunkText, reconstructPageText, wrapText } from "../src/components/fileProcessing/pdfLayout.js"

function textItem(str, x, y, width, height = 10) {
  return {
    str,
    transform: [height, 0, 0, height, x, y],
    width,
    height,
  }
}

test("chunkText preserves lowercase n and punctuation", () => {
  const source = "Translation line one. Another sentence!"
  assert.deepEqual(chunkText(source, 2000), [source])
})

test("chunkText does not insert spaces between Chinese sentences", () => {
  const source = "中文第一句。中文第二句。"
  assert.deepEqual(chunkText(source, 2000), [source])
})

test("reconstructPageText reads two columns from top to bottom", () => {
  const items = [
    textItem("Left first", 40, 740, 70),
    textItem("Right first", 330, 740, 75),
    textItem("Left second.", 40, 728, 80),
    textItem("Right second.", 330, 728, 85),
  ]

  const { text } = reconstructPageText(items, 600)
  assert.ok(text.indexOf("Left first") < text.indexOf("Left second"))
  assert.ok(text.indexOf("Left second") < text.indexOf("Right first"))
  assert.ok(text.indexOf("Right first") < text.indexOf("Right second"))
})

test("reconstructPageText does not inject spaces between adjacent CJK glyphs", () => {
  const items = [
    textItem("中", 40, 740, 10),
    textItem("文", 50, 740, 10),
    textItem("排版", 60, 740, 20),
  ]

  assert.equal(reconstructPageText(items, 600).text, "中文排版")
})

test("wrapText keeps CJK and long URLs inside the available width", () => {
  const font = {
    widthOfTextAtSize: text => Array.from(text).length * 10,
  }
  const lines = wrapText("这是没有空格的中文长句 https://example.com/a-very-long-path", 10, font, 80)

  assert.ok(lines.length > 2)
  lines.filter(Boolean).forEach(line => {
    assert.ok(font.widthOfTextAtSize(line) <= 80, `line is too wide: ${line}`)
  })
})

test("bundled PDF font supports Chinese and Japanese glyphs", async () => {
  const fontBytes = await readFile(new URL(
    "../src/components/assets/fonts/NotoSansSC-VF.ttf",
    import.meta.url,
  ))
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)
  const font = await pdfDoc.embedFont(fontBytes, { subset: true })

  assert.doesNotThrow(() => font.encodeText("中文译文 日本語"))
  const page = pdfDoc.addPage([595, 842])
  page.drawText("中文译文 日本語", { x: 40, y: 780, size: 12, font })
  const output = await pdfDoc.save()
  assert.ok(output.length > 1000)
})
