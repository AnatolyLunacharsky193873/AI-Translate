/**
 * TermExtractor.js
 * * 一个专门用于从长文本中提取高频术语（人名、地名、专有名词、常用短语）的工具。
 * 使用 Web Worker 进行后台处理，避免阻塞主线程。
 * * 核心算法：
 * 1. N-gram 分词 (Unigram, Bigram, Trigram)
 * 2. 停用词边界过滤
 * 3. 频率 + 大写率 + 长度 综合评分
 */

// ==========================================
// 1. Worker 内部代码 (作为字符串存储，运行时生成 Blob)
// ==========================================
const workerCode = () => {
    // --- 配置与常量 ---
    // 英语通用停用词表 (可以根据需要扩展)
    const STOP_WORDS_ENG = new Set([
    "a", "an", "the", "and", "or", "but", "if", "because", "as", "what",
    "when", "where", "how", "why", "who", "which", "this", "that", "these", "those",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
    "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "in", "on", "at", "by", "for", "with", "about", "against", "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once",
    "here", "there", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "now", "well", "still", "even", "another", "however", "since", "yet", "although", "though", "unless", "until", "while", "make", "made", "know", "take", "give", "said", "say", "see", "go", "come", "look", "use", "good", "bad", "new", "old", "first", "last", "long", "great", "little", "own", "other", "old", "right", "big", "high", "different", "small", "large", "next", "early", "young", "important", "few", "public", "bad", "same", "able"
    ])
    
    //法语
    const STOP_WORDS_FRE = new Set(["a", "à", "ai", "aie", "aient", "aies", "ait", "alors", "as", "au", "aucun",
    "aura", "aurai", "auraient", "aurais", "aurait", "auras", "aurez", "auriez",
    "aurions", "aurons", "auront", "aussi", "autre", "aux", "avaient", "avais",
    "avait", "avant", "avec", "avez", "aviez", "avions", "avoir", "avons", "ayant",
    "ayante", "ayantes", "ayants", "ayez", "ayons",
    "bon",
    "c", "car", "ce", "ceci", "cela", "celà", "ces", "cet", "cette", "ceux", "chaque",
    "ci", "comme", "comment", "compris",
    "d", "dans", "de", "debout", "dedans", "dehors", "depuis", "derrière", "des",
    "désormais", "desquelles", "desquels", "dessous", "dessus", "deux", "devant",
    "devers", "devra", "divers", "doit", "donc", "dont", "dos", "droite", "du",
    "duquel", "durant",
    "e", "elle", "elles", "en", "encore", "entre", "envers", "es", "est", "et",
    "étaient", "étais", "était", "étant", "étante", "étantes", "étants", "état",
    "été", "étée", "étées", "étés", "êtes", "étiez", "étions", "être", "eu", "eue",
    "eues", "eurent", "eus", "eusse", "eussent", "eusses", "eussiez", "eussions",
    "eut", "eûmes", "eût", "eûtes", "eux",
    "faire", "fais", "faisaient", "faisant", "fait", "faites", "fois", "font", "force",
    "furent", "fus", "fusse", "fussent", "fusses", "fussiez", "fussions", "fut",
    "fûmes", "fût", "fûtes",
    "haut", "hé", "hors",
    "ici", "il", "ils",
    "j", "je", "juste",
    "l", "la", "là", "le", "les", "leur", "leurs", "lui",
    "m", "ma", "maintenant", "mais", "me", "même", "mes", "mien", "mieux", "moi",
    "moins", "mon", "mot",
    "n", "ne", "ni", "nommés", "nos", "notre", "nous", "nouveaux",
    "on", "ont", "ou", "où", "par", "parce", "parole", "pas", "personnes", "peut",
    "peu", "pièce", "plupart", "pour", "pourquoi", "qu", "quand", "que", "quel",
    "quelle", "quelles", "quels", "qui",
    "s", "sa", "sans", "se", "sera", "serai", "seraient", "serais", "serait", "seras",
    "serez", "seriez", "serions", "serons", "seront", "ses", "seulement", "si", "sien",
    "soi", "soient", "sois", "soit", "sommes", "son", "sont", "sous", "soyez", "soyons",
    "suis", "sujet", "sur",
    "t", "ta", "tandis", "te", "tel", "telle", "telles", "tels", "tes", "toi", "ton",
    "tous", "tout", "toute", "toutes", "très", "trop", "tu",
    "un", "une",
    "valeur", "vers", "via", "voie", "voient", "vont", "vos", "votre", "vous", "vu",
    "y"])

    // 监听主线程消息
    self.onmessage = (e) => {
        const { text, topN, minFreq, language } = e.data;
        
        try {
            const result = analyzeText(text, topN, minFreq, language);
            self.postMessage({ success: true, data: result });
        } catch (error) {
            self.postMessage({ success: false, error: error.message });
        }
    };

    /**
     * 核心分析函数
     */
    function analyzeText(fullText, topN, minFreq, language) {
        // 1. 预处理：保留单词、空格和原始大小写信息
        // 我们不直接转小写，而是存储 original token，以便分析是否大写
        const rawTokens = fullText.match(/[a-zA-Z\u00C0-\u00FF]+|[']/g) || [];
        
        if (rawTokens.length === 0) return [];

        // 哈希表：Key = 小写词组, Value = { count, capitalCount, originalForm }
        const termMap = new Map();

        const len = rawTokens.length;

        // 辅助检测：是否为大写开头
        const isCapitalized = (word) => /^[A-Z]/.test(word);
        
        // 辅助检测：词组首尾是否合法 (不能以停用词开头或结尾)
        const isValidPhrase = (tokens) => {
            const first = tokens[0].toLowerCase();
            const last = tokens[tokens.length - 1].toLowerCase();
            const stopWords = language === "fr" ? STOP_WORDS_FRE : STOP_WORDS_ENG;
            if (stopWords.has(first) || stopWords.has(last)) return false;
            return true;
        };

        // 2. N-gram 滑动窗口 (1 to 3)
        for (let i = 0; i < len; i++) {
            // 最多向后看 3 个词
            for (let n = 1; n <= 3; n++) {
                if (i + n > len) break;

                const slice = rawTokens.slice(i, i + n);
                
                // --- 过滤逻辑 ---
                
                // 忽略纯符号 (比如切分出来的单独的 ' )
                if (slice.some(t => t === "'")) continue;

                const lowerWords = slice.map(w => w.toLowerCase());
                
                // 必须不完全是停用词 (比如 "of the" 直接丢弃)
                const allStop = lowerWords.every(w => STOP_WORDS_FRE.has(w));
                if (allStop) continue;

                // 词组边界检查
                if (!isValidPhrase(slice)) continue;

                // --- 统计逻辑 ---

                const key = lowerWords.join(" ");
                // 忽略太短的词 (比如 "a b")
                if (key.length < 3) continue;

                // 获取或初始化记录
                let record = termMap.get(key);
                if (!record) {
                    record = { 
                        count: 0, 
                        capitalCount: 0, 
                        raw: slice.join(" ") // 记录第一次出现的样子
                    };
                    termMap.set(key, record);
                }

                record.count++;

                // 统计大写情况：如果这一组词全是首字母大写 (Harry Potter)，加分
                const isAllCap = slice.every(isCapitalized);
                if (isAllCap) {
                    record.capitalCount++;
                    // 如果这次是大写的，更新 raw 形式，倾向于展示大写版本
                    record.raw = slice.join(" "); 
                }
            }
        }

        // 3. 评分与排序
        const candidates = [];
        
        termMap.forEach((stats, key) => {
            // 基础频率门槛
            if (stats.count < minFreq) return;

            // --- 评分算法 ---
            // 基础分：频率
            let score = stats.count;

            // 长度加成：词组越长，包含的信息密度通常越大
            // 3-gram * 2.5, 2-gram * 1.5, 1-gram * 1.0
            const wordCount = key.split(' ').length;
            score *= (1 + (wordCount - 1) * 0.8);

            // 大写加成：如果是专有名词 (大写频率高)，大幅增加权重
            const capitalRatio = stats.capitalCount / stats.count;
            if (capitalRatio > 0.5) {
                score *= 2.0; // 专有名词权重翻倍
            }

            candidates.push({
                term: stats.raw,     // 展示形式 (倾向于大写)
                key: key,            // 匹配键 (全小写)
                count: stats.count,
                score: score,
                isProperNoun: capitalRatio > 0.5
            });
        });

        // 4. 排序并取 Top N
        candidates.sort((a, b) => b.score - a.score);

        return candidates.slice(0, topN);
    }
};

// ==========================================
// 2. 导出主函数
// ==========================================

/**
 * 提取文本中的潜在术语
 * @param {string} fullText - 需要分析的完整文本
 * @param {Object} options - 配置项
 * @param {number} options.topN - 返回多少个术语 (默认 100)
 * @param {number} options.minFreq - 最小出现频率 (默认 3)
 * @returns {Promise<Array<{term: string, count: number, score: number}>>}
 */
export function generateTermTable(fullText, options = {}) {
    const { topN = 100, minFreq = 3, language = "en" } = options;

    return new Promise((resolve, reject) => {
        if (!fullText || typeof fullText !== 'string') {
            resolve([]);
            return;
        }

        // 1. 将 worker 函数转为 Blob URL
        const codeString = `(${workerCode.toString()})()`;
        const blob = new Blob([codeString], { type: "application/javascript" });
        const workerUrl = URL.createObjectURL(blob);

        // 2. 创建 Worker
        const worker = new Worker(workerUrl);

        // 3. 发送数据
        worker.postMessage({ text: fullText, topN, minFreq, language });

        // 4. 监听结果
        worker.onmessage = (e) => {
            const { success, data, error } = e.data;
            
            // 清理资源
            worker.terminate();
            URL.revokeObjectURL(workerUrl);

            if (success) {
                resolve(data);
            } else {
                reject(new Error(error));
            }
        };

        // 5. 错误处理
        worker.onerror = (err) => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            reject(err);
        };
    });
}
