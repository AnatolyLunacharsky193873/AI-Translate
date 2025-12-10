import LLM_Request from "../LLM/LLM_Request"

const STOP_WORDS = {
  en: new Set([
    "the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","is","are","was","were","him","had","has","can","could","did","no","yes","any","some","very","when","where","while","than","more","its","itself","same","also","every","first","just","must","only","our","most","because","thus","therefore", "thing"
  ]),
  fr: new Set([
    "a","à","ai","aie","aient","aies","ait","alors","as","au","aucun","aurai","auraient","aurais","aurait","auras","aurez","auriez","aurions","aurons","auront","aussi","autre","aux","avaient","avais","avait","avant","avec","avez","aviez","avions","avoir","avons","ayant","bon","car","ce","ceci","cela","ces","cet","cette","ceux","chaque","ci","comme","comment","d","dans","de","dedans","dehors","depuis","derrière","des","desquelles","desquels","dessous","dessus","deux","devant","devra","doit","donc","dont","du","duquel","durant","elle","elles","en","encore","entre","envers","es","est","et","étaient","étais","était","étant","étions","être","eu","eue","eues","eurent","eus","eusse","eussent","eusses","eussiez","eussions","eut","eux","faire","fais","faisaient","faisant","fait","faites","fois","font","furent","fus","fusse","fussent","fusses","fussiez","fussions","fut","haut","hors","ici","il","ils","j","je","juste","l","la","le","les","leur","leurs","lui","ma","maintenant","mais","me","même","mes","mien","mieux","moi","moins","mon","n","ne","ni","nos","notre","nous","on","ont","ou","où","par","parce","pas","peut","peu","pour","pourquoi","qu","quand","que","quel","quelle","quelles","quels","qui","sa","sans","se","sera","serai","seraient","serais","serait","seras","serez","seriez","serions","serons","seront","ses","si","sien","soi","soient","sois","soit","sommes","son","sont","sous","suis","sur","ta","tandis","te","tel","telle","telles","tels","tes","toi","ton","tous","tout","toute","toutes","très","tu","un","une","vers","voient","vont","vos","votre","vous","y"
  ])
};

/**
 * 翻译术语表：
 * 1) 生成简版列表（仅 term），发送给 LLM_Request 获取双语对照
 * 2) 将译文回填到原有术语表，生成带 translation 的复杂表
 * 3) 返回 { simpleGlossary, translatedGlossary, detailedGlossary }
 *
 * @param {Array<{term: string}>} termTable 原始术语表
 */
export default async function translateGlossary(termTable, options = {}) {
  if (!Array.isArray(termTable) || termTable.length === 0) {
    return { simpleGlossary: [], translatedGlossary: [], detailedGlossary: [] };
  }

  const lang = (options.sourceLang || "en").toLowerCase() === "fr" ? "fr" : "en";
  const stopWords = STOP_WORDS[lang] || STOP_WORDS.en;

  // 清洗 + 去重，同时保留原始统计字段（count/score 等）
  const seen = new Set()
  const simpleGlossary = []
  const detailedGlossary = []
  for (const entry of termTable) {
    let term = entry?.term
    if (!term) continue
    if (term.length < 2) continue
    if (/^\d+$/.test(term)) continue
    if (term === term.toUpperCase() && /[A-Z]/.test(term)) {
      term = term.toLowerCase()
    }
    const termKey = term.toLowerCase()
    if (stopWords.has(termKey)) continue
    if (seen.has(termKey)) continue
    seen.add(termKey)
    simpleGlossary.push({ term })
    detailedGlossary.push({ ...entry, term })
  }

  // 调用 LLM_Request 获取双语术语表（假设能返回 {term, translation}[]）
  let translatedGlossary = [];
  try {
    const result = await LLM_Request([], simpleGlossary, "table", "", options);
    if (Array.isArray(result)) {
      translatedGlossary = result.filter(
        (item) => item && typeof item.term === "string" && typeof item.translation === "string"
      )
    } else if (result && typeof result === "object") {
      // 如果返回的是 { term: translation } 的对象，转换成数组
      translatedGlossary = Object.entries(result).map(([term, translation]) => ({
        term,
        translation,
      }))
    }
  } catch (err) {
    console.warn("Glossary translation failed, fallback to empty translations", err)
    translatedGlossary = []
  }

  const translationMap = new Map(
    translatedGlossary.map(({ term, translation }) => [term.toLowerCase(), translation])
  )

  // 使用清洗后的术语构建可编辑术语表
  const attachTranslation = (list) => list.map((entry) => {
    const translation = translationMap.get((entry.term || "").toLowerCase()) || ""
    return { ...entry, translation }
  })

  return { 
    simpleGlossary: attachTranslation(simpleGlossary), 
    translatedGlossary, 
    detailedGlossary: attachTranslation(detailedGlossary) 
  }
}
