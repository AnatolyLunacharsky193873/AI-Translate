import ePub from 'epubjs'
import { encode } from 'gpt-tokenizer'
import JSZip from 'jszip';
import { generateTermTable } from './termTable'
import LLM_Request from '../LLM/LLM_Request'
import { runWithConcurrency } from '../LLM/asyncUtils'
import translateGlossary from './GlossaryTranslator'

const MAX_CONCURRENCY =20

export default async function EpubProcessor(file, options = {}){
    try{
        console.log("Starting resolve Epub...");
        const { sourceLang = "en", targetLang = "zh", apiKey = "", bookTitle = "", author = "", domain = "", model = "deepseek-chat", glossaryOnly = false, overrideGlossary = null } = options

        const arrayBuffer = await file.arrayBuffer()
        const zip = await JSZip.loadAsync(arrayBuffer)

        if (zip.files["mimetype"]) {
            try {
                zip.files["mimetype"].options.compression = "STORE"
            } catch (err) {
                console.warn("fail to set mimetype STORE", err)
            }
        }

        const book = ePub(arrayBuffer)
        await book.ready

        const spine = book.spine?.spineItems || []
        const sections = [] // 存放 { doc, textNodes, zipFilePath }
        const allBookText = [] // 用于生成术语表

        // --- 第一阶段：解析所有章节结构 ---
        for(const item of spine){
            if(!item.href) continue

            const zipFilePath = findZipPath(zip, item.href)
            if (!zipFilePath) {
                console.warn(`can't find file: ${item.href} in the zip`)
                continue;
            }
            
            // 读取 HTML
            let htmlContent = await zip.file(zipFilePath).async("string")
            const parser = new DOMParser()
            const doc = parser.parseFromString(htmlContent, "application/xhtml+xml")
            
            // 提取节点
            const textNodes = Array.from(doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6"))
                .filter(node => node.textContent.trim().length > 0)
            
            if (textNodes.length === 0) continue

            // 收集文字用于生成术语表
            textNodes.forEach(node => allBookText.push(node.textContent))
            
            // 保存 DOM 引用
            sections.push({ doc, textNodes, zipFilePath })
        }

        if (sections.length === 0){
            console.warn("no readable sections found in EPUB")
            return
        }

        // --- 第二阶段：生成术语表 ---
        const fullPlainText = allBookText.join("\n")
        console.log("Generating termTable...")
        let termTable = await generateTermTable(fullPlainText, { topN: 150, minFreq: 3, language: sourceLang })
        const glossary = await translateGlossary(termTable, { sourceLang, targetLang, apiKey, bookTitle, author, domain, model })
        let translationGlossary = glossary.simpleGlossary
        if (overrideGlossary && Array.isArray(overrideGlossary) && overrideGlossary.length > 0) {
            translationGlossary = overrideGlossary.map(item => ({ term: item.term, translation: item.translation || "" }))
            console.log("using user-edited glossary:", translationGlossary)
        }
        termTable = translationGlossary
        console.log("successfully generated termTable:", termTable)
        if (glossaryOnly) {
            return { detailedGlossary: glossary.detailedGlossary }
        }
        
        
        // --- 第三阶段：分块翻译与回填，并写回 ZIP ---
        for (let sIdx = 0; sIdx < sections.length; sIdx++){
            const { doc, textNodes, zipFilePath } = sections[sIdx]
            console.log(`Preparing chunks for section ${sIdx + 1}/${sections.length}: ${zipFilePath}`);

            const MAX_TOKENS = 1200
            let chunkStartIndex = 0
            let currentChunk = []
            let currentTokenCount = 0
            const tasks = []
            let previousChunkText = ""

            for (let i = 0; i < textNodes.length; i += 1) {
                const text = textNodes[i].textContent
                // 计算 Token
                const nextTokenCount = encode(text).length
                const willExceed = currentTokenCount + nextTokenCount > MAX_TOKENS

                if (willExceed && currentChunk.length > 0) {
                    const chunkSnapshot = [...currentChunk]
                    const start = chunkStartIndex
                    const end = i
                    const contextSnapshot = previousChunkText
                    tasks.push(() => processChunkTask(doc, termTable, chunkSnapshot, start, end, contextSnapshot, { sourceLang, targetLang, apiKey, bookTitle, author, domain, model }))
                    currentChunk = []
                    currentTokenCount = 0
                    chunkStartIndex = i
                    previousChunkText = chunkSnapshot.map(node => node.innerHTML).join("\n")
                }

                currentChunk.push(textNodes[i])
                currentTokenCount += nextTokenCount
            }

            if (currentChunk.length > 0) {
                const chunkSnapshot = [...currentChunk]
                const contextSnapshot = previousChunkText
                tasks.push(() => processChunkTask(doc, termTable, chunkSnapshot, chunkStartIndex, textNodes.length, contextSnapshot, { sourceLang, targetLang, apiKey, bookTitle, author, domain, model }))
                previousChunkText = chunkSnapshot.map(node => node.innerHTML).join("\n")
            }

            console.log(`Section ${sIdx + 1} has ${tasks.length} chunks. Starting concurrent translation...`);
            let finished = 0
            const wrappedTasks = tasks.map((task, idx) => async () => {
                const res = await task()
                finished += 1
                const percent = ((finished / tasks.length) * 100).toFixed(1)
                console.log(`Section ${sIdx + 1}: chunk ${idx + 1}/${tasks.length} done (${percent}%)`)
                return res
            })
            await runWithConcurrency(wrappedTasks, MAX_CONCURRENCY)

            // 将修改后的 DOM 序列化并写回 ZIP
            const serializer = new XMLSerializer()
            const newHtmlContent = serializer.serializeToString(doc)
            zip.file(zipFilePath, newHtmlContent)
        }

        //生成新的 EPUB 文件
        console.log("wrapping new Epub file...");
        // 1. 如果原包里有 mimetype，先删除 (JSZip 不一定保证覆盖顺序)
        if (zip.file("mimetype")) {
            zip.remove("mimetype");
        }
        // 2. 重新写入 mimetype，强制不压缩
        zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

        const generatedEpubBlob = await zip.generateAsync({ 
            type: "blob", 
            mimeType: "application/epub+zip",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });
        
        triggerDownload(generatedEpubBlob, file.name.replace(/\.[^.]+$/, "") + "_translated.epub")
        console.log("successfully generated new Epub!");

    } catch(error){
        console.error("fail to resolve Epub:", error)
    }
}

function injectTranslation(doc, currentChunk, translated, chunkStartIndex, endIndex){
    const translatedTexts = Array.isArray(translated) ? translated : [translated]
    
    // 如果数量一致，一一对应插入
    if (translatedTexts.length === currentChunk.length){
        for(let i=0; i<currentChunk.length; i+=1){
            const clone = shallowCloneNode(currentChunk[i])
            setInnerHTMLSafe(clone, translatedTexts[i])
            currentChunk[i].parentNode?.insertBefore(clone, currentChunk[i].nextSibling)
        }
    } else {
        const joinAll = Array.isArray(translated) ? translated.join("<br/>") : translated
        const target = currentChunk[currentChunk.length - 1]
        const wrapper = shallowCloneNode(target)
        setInnerHTMLSafe(wrapper, joinAll)
        target.parentNode?.insertBefore(wrapper, target.nextSibling)
    }
    console.log(`Finished chunk: ${chunkStartIndex} - ${endIndex}`)
}

function shallowCloneNode(node){
    const clone = node.cloneNode(false)
    clone.removeAttribute("id")
    return clone;
}

function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

async function processChunkTask(doc, termTable, currentChunk, chunkStartIndex, endIndex, contextSnapshot, options){
    if (currentChunk.length === 0) return
    
    const chunkTexts = currentChunk.map(node => node.innerHTML)
    
    
    const translated = await LLM_Request(chunkTexts, termTable, "text", contextSnapshot, options).catch(err => {
        console.warn("LLM translation failed, fallback to source text", err)
        return chunkTexts
    })
    injectTranslation(doc, currentChunk, translated, chunkStartIndex, endIndex)
}

function findZipPath(zip, href) {
    const withoutFragment = href.split("#")[0]
    const decoded = decodeURIComponent(withoutFragment)
    const normalized = decoded.replace(/\\/g, "/")
    const resolved = collapsePath(normalized)
    if (zip.file(resolved)) return resolved
    const found = Object.keys(zip.files).find(path => path.endsWith(resolved));
    return found;
}

function collapsePath(path){
    const parts = path.split("/")
    const stack = []
    for (const part of parts){
        if (part === "" || part === ".") continue
        if (part === ".."){
            stack.pop()
        } else {
            stack.push(part)
        }
    }
    return stack.join("/")
}
function fixAndValidateXHTML(rawHtml) {
    try {
        // 1. 利用浏览器的 HTML 解析器进行“宽容解析”
        // 浏览器非常擅长自动闭合标签 (比如把 <b>text 解析成 <b>text</b>)
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(`<body>${rawHtml}</body>`, "text/html");
        
        // 2. 检查是否有解析错误（虽然 text/html 很难报错，但防万一）
        const parserError = htmlDoc.querySelector("parsererror");
        if (parserError) {
            console.warn("HTML 解析严重错误，回退到纯文本:", rawHtml);
            return stripTags(rawHtml); // 兜底：去标签
        }

        // 3. 安全性检查：防止 LLM 幻觉生成 <script> 或 <iframe> 等危险标签
        const forbiddenTags = ["script", "iframe", "style", "link", "meta"];
        forbiddenTags.forEach(tag => {
            const badNodes = htmlDoc.querySelectorAll(tag);
            badNodes.forEach(node => node.remove());
        });

        // 4. 利用 XMLSerializer 强制输出为 XHTML 格式
        // 这一步会将 <br> 变成 <br/>，<img> 变成 <img/>，并确保所有标签闭合
        const serializer = new XMLSerializer();
        
        // 我们只需要 body 里面的内容，不需要外面的 <body> 标签
        let validXHTML = "";
        Array.from(htmlDoc.body.childNodes).forEach(node => {
            validXHTML += serializer.serializeToString(node);
        });

        return validXHTML;

    } catch (e) {
        console.error("XHTML 修复失败:", e)
        //回退到纯文本
        return stripTags(rawHtml)
    }
}

// 辅助函数：去除所有标签，只留文字
function stripTags(str) {
    return str.replace(/<[^>]*>?/gm, "");
}

function setInnerHTMLSafe(node, html) {
    try {
        const cleaned = fixAndValidateXHTML(html)
        node.innerHTML = cleaned
    } catch (err) {
        console.warn("setInnerHTMLSafe fallback to textContent due to invalid XHTML", err)
        node.textContent = stripTags(html)
    }
}
