import React, { useState, useRef } from "react";
import { UploadCloud, FileText, Languages, Key, ArrowRight, X, Loader2 } from "lucide-react";
import "./translatePage.css"
import EpubProcessor from "../fileProcessing/EpubProcessor"
import PDFProcessor from "../fileProcessing/PDFProcessor"
import { useNavigate } from "react-router-dom";

const TranslationPage = () => {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const [glossaryReady, setGlossaryReady] = useState(false);
  const [editableGlossary, setEditableGlossary] = useState([]);
  const [showMetaForm, setShowMetaForm] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(null);
  const [useGlossary, setUseGlossary] = useState(true);
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    apiKey: "",
    fileType: "epub",
    sourceLang: "eng",
    targetLang: "zh",
    model: "deepseek-chat",
    bookTitle: "",
    author: "",
    domain: ""
  });

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };
  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };
  
  const handleTranslate = async () => {
    if (!file || !formData.apiKey) return;
    const TypeofFile = file.name.split(".").pop()?.toLowerCase()
    if (formData.fileType != TypeofFile){
      alert(`Uploaded file format is different from selected document format, Uploaded ${TypeofFile}, expecting ${formData.fileType}`)
      return
    }
    setIsProcessing(true)
    if (glossaryReady) {
      setTranslateProgress(0)
    } else {
      setTranslateProgress(null)
    }
    if (formData.fileType === "epub"){
      await EpubProcessor(file, {
        apiKey: formData.apiKey,
        sourceLang: formData.sourceLang,
        targetLang: formData.targetLang,
        model: formData.model,
        bookTitle: formData.bookTitle,
        author: formData.author,
        domain: formData.domain,
        useGlossary,
        glossaryOnly: useGlossary ? !glossaryReady : false,
        overrideGlossary: glossaryReady ? editableGlossary : null,
        onProgress: glossaryReady ? (done, total) => {
          if (total > 0) {
            setTranslateProgress(Math.min(100, ((done / total) * 100)));
          }
        } : undefined
      }).then((res) => {
        if (useGlossary && !glossaryReady && res?.detailedGlossary) {
          const sorted = [...res.detailedGlossary].sort((a, b) => (b.count || 0) - (a.count || 0))
          setEditableGlossary(sorted)
          setGlossaryReady(true)
        }
      })
    } else if (formData.fileType === "pdf") {
      await PDFProcessor(file, {
        apiKey: formData.apiKey,
        sourceLang: formData.sourceLang,
        targetLang: formData.targetLang,
        model: formData.model,
        bookTitle: formData.bookTitle,
        author: formData.author,
        domain: formData.domain,
        useGlossary,
        glossaryOnly: useGlossary ? !glossaryReady : false,
        overrideGlossary: glossaryReady ? editableGlossary : null,
        onProgress: glossaryReady ? (done, total) => {
          if (total > 0) {
            setTranslateProgress(Math.min(100, ((done / total) * 100)));
          }
        } : undefined
      }).then((res) => {
        if (useGlossary && !glossaryReady && res?.detailedGlossary) {
          const sorted = [...res.detailedGlossary].sort((a, b) => (b.count || 0) - (a.count || 0))
          setEditableGlossary(sorted)
          setGlossaryReady(true)
        }
      })
    }
    setIsProcessing(false)
    setTranslateProgress(null)
  }

  return (
    <div className="translate-root">
      <div className="translate-shell">
        <header className="translate-header">
          <h1 className="translate-title font-cinzel">TRANSLATE</h1>
          <p className="translate-subtitle">
            "Bridging worlds, one document at a time."
          </p>
        </header>

        <div className="translate-grid">
          <div className="translate-panel-stack">
            <div className="translate-panel">
              <div className="translate-panel-heading">
                <Key size={18} />
                <span className="font-cinzel">ACCESS CREDENTIALS</span>
              </div>
              <div className="translate-field">
                <label className="translate-label">LLM API Key
                  <button
                    type="button"
                    className="translate-help"
                    onClick={() => navigate("/features#api-key-card")}
                    title="What is it?"
                  >
                    ?
                  </button>
                </label>
                <input
                  type="password"
                  placeholder="sk-..."
                  className="translate-input"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                />
              </div>
              <div className="translate-field">
                <label className="translate-label">Model Selection</label>
                <select
                  className="translate-input"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                >
                  <option value="deepseek-chat">deepseek-chat(Recommended)</option>
                  <option value="gpt-5-mini">gpt-5-mini</option>
                  <option value="gpt-5.2">gpt-5.2</option>
                </select>
              </div>
              <label className="translate-checkbox">
                <input
                  type="checkbox"
                  checked={useGlossary}
                  onChange={(e) => {
                    setUseGlossary(e.target.checked)
                    if (!e.target.checked) {
                      setGlossaryReady(false)
                      setEditableGlossary([])
                    }
                  }}
                />
                Use terminology glossary
              </label>
            </div>

            <div className="translate-panel">
              <div className="translate-panel-heading">
                <Languages size={18} />
                <span className="font-cinzel">LINGUISTIC PARAMETERS</span>
              </div>
              <div className="translate-field">
                <label className="translate-label">Source Language</label>
                <select
                  className="translate-input"
                  value={formData.sourceLang}
                  onChange={(e) => setFormData({ ...formData, sourceLang: e.target.value })}
                >
                  <option value="detect this language">Auto Detect</option>
                  <option value="en">English</option>
                  <option value="zh">Chinese</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="jp">Japanese</option>
                </select>
              </div>
              <div className="translate-field">
                <label className="translate-label">Target Language</label>
                <select
                  className="translate-input"
                  value={formData.targetLang}
                  onChange={(e) => setFormData({ ...formData, targetLang: e.target.value })}
                >
                  <option value="zh">Simplified Chinese</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="jp">Japanese</option>
                  <option value="fr">French</option>
                </select>
              </div>
              <button
                type="button"
                className="translate-format-button"
                onClick={() => setShowMetaForm(!showMetaForm)}
              >
                {showMetaForm ? "Hide Details" : "Set Details"}
              </button>
              {showMetaForm && (
                <div className="translate-field">
                  <label className="translate-label">Book Title</label>
                  <input
                    type="text"
                    className="translate-input"
                    placeholder="Optional"
                    value={formData.bookTitle}
                    onChange={(e) => setFormData({ ...formData, bookTitle: e.target.value })}
                  />
                  <label className="translate-label">Author</label>
                  <input
                    type="text"
                    className="translate-input"
                    placeholder="Optional"
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                  />
                  <label className="translate-label">Domain</label>
                  <input
                    type="text"
                    className="translate-input"
                    placeholder="e.g. Philosophy"
                    value={formData.domain}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="translate-actions">
            <div
              className={`translate-dropzone ${isDragging ? "dragging" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="translate-file-input"
                accept=".epub,.pdf,.docx,.txt"
              />

              {file ? (
                <div className="translate-upload-info">
                  <div className="translate-upload-icon translate-upload-icon--file">
                    <FileText size={30} color="#cba164" />
                  </div>
                  <h3 className="font-cinzel translate-dropzone-title">{file.name}</h3>
                  <p className="translate-upload-meta">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    className="translate-remove-button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  >
                    <X size={14} /> Remove File
                  </button>
                </div>
              ) : (
                <>
                  <div className="translate-upload-icon">
                    <UploadCloud size={40} color="#9d8f73" />
                  </div>
                  <h3 className="font-cinzel translate-dropzone-title">Upload File</h3>
                  <p className="translate-dropzone-text">
                    Drag and drop your manuscript here, or click to browse.
                    <span className="translate-dropzone-note">Supported formats: EPUB, PDF, DOCX</span>
                  </p>
                </>
              )}
            </div>

            <div className="translate-format-controls">
              <span className="translate-format-label">Document Format:</span>
              {["epub", "pdf", "docx"].map((type) => (
                <button
                  key={type}
                  onClick={() => setFormData({ ...formData, fileType: type })}
                  className={`translate-format-button ${formData.fileType === type ? "active" : ""}`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>

            <button
              onClick={handleTranslate}
              disabled={!file || !formData.apiKey || isProcessing}
              className={`translate-submit ${file && formData.apiKey && !isProcessing ? "animate-pulse-gold" : ""}`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="translate-spinner" /> TRANSLATING...
                </>
              ) : (
                <>
                  {glossaryReady ? "BEGIN TRANSLATION" : "GENERATE TERMTABLE"} <ArrowRight size={20} />
                </>
              )}
            </button>
            {translateProgress !== null && (
              <div className="translate-progress">
                <div className="translate-progress-bar" style={{ width: `${translateProgress}%` }} />
                <span className="translate-progress-text">{translateProgress.toFixed(1)}%</span>
              </div>
            )}

            {glossaryReady && (
              <div className="translate-panel" style={{ marginTop: "1rem" }}>
                <div className="translate-panel-heading">
                  <FileText size={18} />
                  <span className="font-cinzel">GLOSSARY EDITOR</span>
                </div>
                <p className="translate-dropzone-note">Edit translations, remove rows, or add new terms before final translation.</p>
                <div className="glossary-editor">
                    {editableGlossary.map((item, idx) => (
                      <div className="glossary-row" key={`${item.term}-${idx}`}>
                        <input
                          className="translate-input"
                          value={item.term}
                          onChange={(e) => {
                            const next = [...editableGlossary];
                            next[idx] = { ...next[idx], term: e.target.value };
                            setEditableGlossary(next);
                          }}
                          placeholder="Term"
                        />
                        <input
                          className="translate-input"
                          value={item.translation || ""}
                          onChange={(e) => {
                            const next = [...editableGlossary];
                            next[idx] = { ...next[idx], translation: e.target.value };
                            setEditableGlossary(next);
                          }}
                          placeholder="Translation"
                        />
                        <span className="translate-count-pill">freq: {item.count ?? 0}</span>
                        <div className="glossary-row-actions">
                          <button
                            type="button"
                            className="translate-remove-button"
                            onClick={() => {
                              const next = editableGlossary.filter((_, i) => i !== idx);
                              setEditableGlossary(next);
                            }}
                          >
                            <X size={14} /> Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  <button
                    type="button"
                    className="translate-format-button"
                    onClick={() => setEditableGlossary([...editableGlossary, { term: "", translation: "" }])}
                  >
                    Add Term
                  </button>
                </div>
              </div>
            )}

             <div className="translate-warning-stack">
              {!formData.apiKey && (
              <p className="translate-warning">* API Key is required to proceed</p>
            )}
            {!file && (
                <p className="translate-warning">* File is required to proceed</p>
            )}  
             </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default TranslationPage;
