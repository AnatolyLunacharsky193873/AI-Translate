import React, { useEffect, useState } from 'react';
import { Layers, Zap, BookOpen, ShieldCheck, Code2, Cpu } from 'lucide-react';
import "./features.css";

const featuresData = [
  {
    id: "API",
    icon: <Cpu size={32} />,
    title: "LLM API Keys",
    subtitle: "Access for OpenAI / DeepSeek",
    body: (
      <>
        An API key unlocks the models that power translation. Purchase or manage keys from{" "}
        <a className="feature-link" href="https://platform.openai.com/docs/overview" target="_blank" rel="noreferrer">OpenAI</a>{" "}
        or{" "}
        <a className="feature-link" href="https://platform.deepseek.com/usage" target="_blank" rel="noreferrer">DeepSeek</a>, then paste it in the translator to authenticate requests.
      </>
    ),
    className: "feature-wide",
    techSpec: "AUTH: REQUIRED"
  },
  {
    id: "01",
    icon: <Layers size={32} />,
    title: "Context-Aware Chunks",
    subtitle: "The Sliding Window Protocol",
    body: "Standard APIs have amnesia. We solve this by implementing a token-based sliding window. We feed the trailing 500 tokens of the previous chunk into the next request, creating a chain of context. This ensures that narrative arcs, character pronouns, and subtle tonal shifts remain unbroken across chapter boundaries, rather than drifting into generic machine prose.",
    className: "feature-wide",
    techSpec: "TOKEN_OVERLAP: 1200"
  },
  {
    id: "02",
    icon: <Zap size={32} />,
    title: "Adaptive Concurrency",
    subtitle: "Non-Blocking Throughput",
    body: "Speed is nothing without control. Our engine manages a semaphore-restricted pool of workers, dynamically adjusting concurrency based on API latency. We trade idle CPU cycles for velocity, processing batches in parallel while maintaining strict deterministic order for the final reassembly.",
    className: "feature-tall",
    techSpec: "MAX_THREADS: DYNAMIC"
  },
  {
    id: "03",
    icon: <BookOpen size={32} />,
    title: "LLM-Built Glossary",
    subtitle: "Semantic Frequency Analysis",
    body: "Before translation, a pre-flight scan identifies high-frequency proper nouns. An agent proposes consistent translations for these terms (e.g., ensuring 'Winterfell' doesn't become 'The Cold City'). You can edit this map, enforcing your preferences across the entire document.",
    className: "feature-tall",
    techSpec: "ENTITY_RECOGNITION: ON"
  },
  {
    id: "04",
    icon: <ShieldCheck size={32} />,
    title: "Robustness Layer",
    subtitle: "Graceful Degradation",
    body: "The network is chaotic; our parser is stoic. Every request is wrapped in a retry harness with exponential backoff. If a text node contains malformed HTML or triggers a 429 error, the system downgrades to a safe-text fallback mode rather than crashing, ensuring you always receive a valid EPUB file.",
    className: "feature-standard",
    techSpec: "RETRY_STRATEGY: EXP_BACKOFF"
  },
  {
    id: "05",
    icon: <Code2 size={32} />,
    title: "DOM Preservation",
    subtitle: "Isomorphic Structure",
    body: "We treat formatting as sacred. Using a shadow DOM traversal strategy, we extract text nodes while preserving the exact hierarchy of italics, bold tags, and CSS classes. The translated content is injected via sanitized innerHTML, so the bilingual export retains the visual soul of the original book.",
    className: "feature-wide",
    techSpec: "SANITIZATION: STRICT"
  }
];

const Features = () => {
  const [highlightId, setHighlightId] = useState("");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "api-key-card") {
      setHighlightId("API");
      const timer = setTimeout(() => setHighlightId(""), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="features-root">
      <div className="features-spiral-bg" aria-hidden="true"></div>
      <div className="features-shell">
        
        <header className="features-header">
          <div className="features-eyebrow">System Architecture</div>
          <h1 className="features-title">The Engine Room</h1>
          <p className="features-subtitle">
            A dissection of the pipeline transforming static text into fluid knowledge.
          </p>
          <div className="features-divider">
            <span className="dot"></span>
            <span className="line"></span>
            <span className="dot"></span>
          </div>
        </header>

        <div className="features-grid">
          {featuresData.map((feature) => (
            <div
              key={feature.id}
              id={feature.id === "API" ? "api-key-card" : undefined}
              className={`feature-card ${feature.className} ${highlightId === feature.id ? "feature-highlight" : ""}`}
            >
              
              <div className="feature-bg-tech"></div>

              <div className="feature-card-header">
                <div className="feature-icon-wrapper">
                  {feature.icon}
                </div>
              </div>

              <div className="feature-content">
                <div className="feature-tech-spec">{feature.techSpec}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <h4 className="feature-subtitle">{feature.subtitle}</h4>
                <p className="feature-body">{feature.body}</p>
              </div>

            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default Features
