/**
 * Knowledge Base & Hybrid Retrieval Engine
 *
 * Fixes vs. the previous version:
 * - CJK-aware tokenisation (bigrams) — Chinese documents used to collapse into a single
 *   token, which silently disabled retrieval for any non-space-delimited language.
 * - chunking is token-based and works for CJK (no whitespace required).
 * - the "embedding" is renamed and documented as a deterministic hashed bag-of-grams
 *   (it is NOT a semantic model). Keyword scoring is the honest recall path; the vector
 *   path is a stable tie-breaker. `scoreKind` reports which path dominated.
 */
import {
  KnowledgeChunk,
  KnowledgeQueryResult,
  KnowledgeBaseConfig
} from '../types/index.js';

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN_WORD = /[a-z0-9_]+/g;

interface TokenizeResult {
  tokens: string[];
  source: 'cjk' | 'latin' | 'mixed';
}

export class KnowledgeBase {
  public config: KnowledgeBaseConfig;
  private chunks: Map<string, KnowledgeChunk> = new Map();

  constructor(config?: Partial<KnowledgeBaseConfig>) {
    this.config = {
      id: config?.id ?? 'default-kb',
      name: config?.name ?? 'Default Knowledge Base',
      description: config?.description ?? 'General domain and technical knowledge base',
      chunkSize: config?.chunkSize ?? 120,
      chunkOverlap: config?.chunkOverlap ?? 20,
      hybridAlpha: config?.hybridAlpha ?? 0.5
    };
  }

  public addDocument(
    docId: string,
    title: string,
    fullContent: string,
    metadata: Record<string, any> = {}
  ): KnowledgeChunk[] {
    const pieces = this.chunkText(fullContent, this.config.chunkSize, this.config.chunkOverlap);
    const created: KnowledgeChunk[] = [];

    pieces.forEach((content, index) => {
      const id = `${docId}#c${index + 1}`;
      const chunk: KnowledgeChunk = {
        id,
        docId,
        title,
        content,
        metadata: { ...metadata, chunkIndex: index, totalChunks: pieces.length },
        embedding: this.hashEmbedding(content)
      };
      this.chunks.set(id, chunk);
      created.push(chunk);
    });

    return created;
  }

  public query(queryString: string, topK = 3): KnowledgeQueryResult[] {
    const { tokens: queryTokens } = this.tokenize(queryString);
    const queryVec = this.hashEmbedding(queryString);
    const alpha = this.config.hybridAlpha;

    const scored: Array<{
      chunk: KnowledgeChunk;
      score: number;
      keyword: number;
      vector: number;
      matchType: 'keyword' | 'vector' | 'hybrid';
    }> = [];

    for (const chunk of this.chunks.values()) {
      const { tokens: chunkTokens } = this.tokenize(chunk.content);
      const tokenSet = new Set(chunkTokens);

      let hits = 0;
      for (const t of queryTokens) if (tokenSet.has(t)) hits++;
      // length normalisation keeps long chunks from winning by sheer size
      const keywordScore = queryTokens.length === 0 ? 0 : hits / queryTokens.length;

      const vectorScore = chunk.embedding ? this.cosine(queryVec, chunk.embedding) : 0;
      const hybrid = alpha * vectorScore + (1 - alpha) * keywordScore;

      const matchType: 'keyword' | 'vector' | 'hybrid' =
        alpha === 0 ? 'keyword' : alpha === 1 ? 'vector' : 'hybrid';

      if (keywordScore > 0 || hybrid > 0.15) {
        scored.push({ chunk, score: hybrid, keyword: keywordScore, vector: vectorScore, matchType });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.keyword - a.keyword);

    return scored.slice(0, topK).map(s => ({
      chunk: s.chunk,
      score: Number(Math.min(1, Math.max(0, s.score)).toFixed(4)),
      matchType: s.keyword > s.vector ? (alpha === 0 ? 'keyword' : 'hybrid') : s.matchType,
      citation:
        `[Source: ${s.chunk.title} (${s.chunk.id}) | relevance ${(Math.min(1, s.score) * 100).toFixed(1)}%` +
        ` | kw ${(s.keyword * 100).toFixed(0)}% / vec ${(s.vector * 100).toFixed(0)}%]`
    }));
  }

  public getChunkCount(): number {
    return this.chunks.size;
  }

  public getDocumentIds(): string[] {
    return Array.from(new Set(Array.from(this.chunks.values()).map(c => c.docId)));
  }

  // ---------------------------------------------------------------- internals

  /**
   * CJK -> character bigrams; Latin -> words. Mixed text gets both streams.
   * Bigrams are the standard lightweight answer to "Chinese has no spaces".
   */
  private tokenize(text: string): TokenizeResult {
    const lower = text.toLowerCase();
    const tokens: string[] = [];
    let cjkSeen = false;
    let latinSeen = false;

    // latin words / identifiers / numbers
    for (const m of lower.matchAll(LATIN_WORD)) {
      if (m[0].length > 1) {
        tokens.push(m[0]);
        latinSeen = true;
      }
    }

    // CJK bigrams (plus single chars for 1-char segments)
    const cjkRuns = lower.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) ?? [];
    for (const run of cjkRuns) {
      cjkSeen = true;
      if (run.length === 1) {
        tokens.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }

    return {
      tokens: Array.from(new Set(tokens)),
      source: cjkSeen && latinSeen ? 'mixed' : cjkSeen ? 'cjk' : 'latin'
    };
  }

  /** ~2.2 tokens per CJK char, ~1 token per 4 latin chars. Token-based, language-neutral. */
  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const units = this.toChunkUnits(text);
    if (units.length <= chunkSize) return [text];

    const step = Math.max(1, chunkSize - overlap);
    const out: string[] = [];
    for (let start = 0; start < units.length; start += step) {
      const end = Math.min(units.length, start + chunkSize);
      out.push(units.slice(start, end).map(u => u.text).join(''));
      if (end >= units.length) break;
    }
    return out;
  }

  /** Split into CJK characters and Latin words, keeping the whitespace glue. */
  private toChunkUnits(text: string): Array<{ text: string; weight: number }> {
    const units: Array<{ text: string; weight: number }> = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (CJK.test(ch)) {
        units.push({ text: ch, weight: 1 });
        i++;
      } else if (/[a-zA-Z0-9_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        units.push({ text: text.slice(i, j) + ' ', weight: 1 });
        i = j;
      } else {
        if (ch === '\n') units.push({ text: '\n', weight: 1 });
        else if (ch === ' ') units.push({ text: ' ', weight: 1 });
        i++;
      }
    }
    // normalise: treat every unit as roughly one token for chunking purposes
    return units.map(u => ({ text: u.text, weight: 1 }));
  }

  /**
   * Deterministic 64-dim hashed token-frequency vector, L2-normalised.
   * NOT a learned embedding — it is a stable lexical fingerprint used only as a
   * smoothing signal on top of keyword recall.
   */
  private hashEmbedding(text: string): number[] {
    const dim = 64;
    const vec = new Array(dim).fill(0);
    const { tokens } = this.tokenize(text);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      vec[h % dim] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  private cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += a[i] * b[i];
    return Math.max(0, dot);
  }
}
