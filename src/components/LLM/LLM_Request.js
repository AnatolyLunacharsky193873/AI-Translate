import OpenAI from "openai";
const MAX_RETRIES = 3
const BASE_DELAY_MS = 200
const REQUEST_TIMEOUT_MS = 60000

export default async function LLM_Request(textChunks, termTable, mode = "text", context = "", options = {}){
  const sourceLang = options.sourceLang
  const targetLang = options.targetLang
  const author = options.author
  const bookTitle = options.bookTitle
  const domain = options.domain
  const apiKey = options.apiKey
  const presetPrompt = ""
  let parsedResult = []

  const openai = new OpenAI({
      baseURL: window.location.origin + '/deepseek',
      apiKey,
      dangerouslyAllowBrowser: true
  })

  if (mode === "table") {
      // textChunks
      const termList = termTable; 
      
      const systemPrompt = buildGlossaryPrompt(sourceLang, targetLang, bookTitle, author, domain, presetPrompt);
      const userPrompt = JSON.stringify(termList);

      console.log("🚀 [Glossary] Sending request to DeepSeek...");

      try {
        const completion = await sendWithRetry(() => openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "deepseek-chat",
            temperature: 1.3,
            response_format: { type: "json_object" },
            timeout: REQUEST_TIMEOUT_MS
        }))

        const rawContent = completion.choices[0].message.content;
        parsedResult = JSON.parse(rawContent);
        console.log("✅ [Glossary] Generated Term Table:", parsedResult)
        
        return parsedResult;

      } catch (error) {
          console.error("❌ [Glossary] Failed:", error)
          return {}
      }
    }
  else if(mode === "text"){
    const glossaryJson = JSON.stringify(termTable || [])
    const systemPrompt = buildTranslationPrompt(sourceLang, targetLang, bookTitle, author, domain, glossaryJson)
    const userPayload = JSON.stringify({
      context: context || "",
      text_to_translate: textChunks || []
    })
    try{
      const completion = await sendWithRetry(() => openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload }
        ],
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        timeout: REQUEST_TIMEOUT_MS
      }))
      const rawContent = completion.choices[0].message.content
      console.log("[Text] rawContent:", rawContent)
      try{
        const parsed = JSON.parse(rawContent || "{}")
        if (parsed && Array.isArray(parsed.translations)) {
          return parsed.translations
        }
        return textChunks
      }catch(parseErr){
        console.error("❌ [Text] JSON parse failed:", parseErr)
        return textChunks
      }
    }catch(err){
      console.error("❌ [Text] Failed:", err)
      return textChunks
    }
  }

  /**
   * 构建用于生成术语表的 System Prompt
   * @param {string} sourceLang - 原文语言
   * @param {string} targetLang - 目标语言
   * @param {string} bookTitle - 书名
   * @param {string} author - 作者
   * @param {string} domain - 领域 (e.g., "Philosophy", "Fantasy Novel")
   * @param {string} presetPrompt -在prompt前的prompt，可以用来处理一些特殊情况，默认为空
   */
  function buildGlossaryPrompt(sourceLang, targetLang ,bookTitle, author, domain, presetPrompt) {
      return `${presetPrompt}\nYou are an expert terminologist and translator specializing in **${domain}**. 
  Your task is to translate a list of extracted terms from ${sourceLang} to ${targetLang} for the book **"${bookTitle}"** by **${author}**.

  ### 1. Contextual Knowledge Retrieval (CRITICAL)
  Before translating, access your internal knowledge base regarding **${author}**'s entire body of work and specifically **"${bookTitle}"**.
  - **Canonical Translations**: You MUST prioritize established, canonical translations used in existing published editions of this book.
  - **Author's Idiolect**: If ${author} uses specific words in unique ways (e.g., Hegel's "Geist", Heidegger's "Dasein", or Rowling's "Muggle"),
   you must use the accepted standard translation for that specific context, not the literal dictionary definition.
  - **Reference Translator**: "Follow the most widely accepted scholarly or literary standard."}

  ### 2. Disambiguation Rules
  - **Polysemy**: If a term has multiple meanings, choose the one that fits the specific context of **${domain}** and this specific book.
  - **Consistency**: Ensure that related terms follow a consistent naming convention (e.g., consistent rank names in a military novel).

  ### 3. Output Format
  - You will receive a JSON array of English terms.
  - You must return a strict **JSON Object** where keys are the English terms and values are the Chinese translations.
  - Format: \`{ "${sourceLang} Term": "${targetLang} Translation", ... }\`example: "Being": "存在" 
  - Do not add explanations or notes. Only return the JSON.`
  }


  /**
   * 构建用于正文翻译的 System Prompt
   * @param {string} sourceLang - 原文语言
   * @param {string} targetLang - 目标语言
   * @param {string} bookTitle - 书名
   * @param {string} author - 作者
   * @param {string} domain - 领域
   * @param {string} parsedResult - 术语表 JSON string
   */
  function buildTranslationPrompt(sourceLang, targetLang, bookTitle, author, domain, parsedResult) {
      return `You are an expert translator specializing in **${domain}**.
  Your task is to translate specific text chunks from ${sourceLang} to ${targetLang} for the book **"${bookTitle}"** by **${author}**.

  ### 1. CRITICAL: Glossary Compliance (Highest Priority)
  You have been provided with a specialized glossary for this book.
  **Rule:** If a term in the source text appears in the glossary below, you **MUST** use the provided translation. Do NOT use synonyms.
  ${parsedResult}

  ### 2. Context Awareness (Sliding Window)
  You will receive the input in a specific JSON structure containing:
  - \`context\`: The preceding text (previous paragraph).
    - **Usage:** Read this to understand the narrative flow, tone, and resolve ambiguous pronouns (e.g., knowing who "he" refers to).
    - **Constraint:** **NEVER TRANSLATE THE CONTENT IN \`context\`.** It is for reference only.
  - \`text_to_translate\`: The actual array of sentences/paragraphs you need to translate.
    - **Action:** Translate these items one by one.
    - **Continuity:** Ensure the translation of the first sentence flows naturally from the meaning of the \`context\`.

  ### 3. Stylistic Guidelines
  - **Tone**: Maintain the academic/literary tone of **${author}** in **${domain}**.
  - **Formatting**: Preserve all HTML tags (like <em>, <strong>), symbols, and special formatting exactly as they appear. You MUST preserve these tags in the translation at the correct positions. Do NOT remove or translate the tag names themselves.

  ### 4. Output Format (Strict JSON)
  - CRITICAL: RAW JSON ONLY
  - Return a JSON Object with a single key: "translations".
  - The value must be an Array of strings.
  - **CRITICAL LENGTH CONSTRAINT:** The length of the output \`translations\` array **MUST BE IDENTICAL** to the input \`text_to_translate\` array.
  - Do NOT include any translation for the \`context\` field.
  - Example:
    Input: { "context": "...", "text_to_translate": ["A", "B"] }
    Output: { "translations": ["TransA", "TransB"] }`;
  }

  async function sendWithRetry(requestFn){
    let attempt = 0
    let lastError = null
    while (attempt < MAX_RETRIES){
      try{
        attempt += 1
        return await requestFn()
      }catch(err){
        lastError = err
        const status = err?.status || err?.response?.status
        const isTimeout = err?.message?.toLowerCase().includes("timeout")
        const retryable = isTimeout || status === 429 || (status >= 500 && status < 600)
        if (!retryable || attempt >= MAX_RETRIES){
          throw err
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
        console.warn(`LLM retry ${attempt}/${MAX_RETRIES} after error`, err?.message || err)
        await new Promise(res => setTimeout(res, delay))
      }
    }
    throw lastError
  }

}
