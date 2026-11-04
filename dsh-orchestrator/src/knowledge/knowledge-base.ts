/**
 * Knowledge Base & Hybrid RAG Engine
 * Features:
 * 1. Document ingestion & semantic chunking
 * 2. Hybrid search (BM25 keyword match + Cosine vector similarity)
 * 3. Citation generation & Source provenance tracking
 */
import { 
  KnowledgeChunk, 
  KnowledgeQueryResult, 
  KnowledgeBaseConfig 
} from '../types/index.js';

export class KnowledgeBase {
  public config: KnowledgeBaseConfig;
  private chunks: Map<string, KnowledgeChunk> = new Map();

  constructor(config?: Partial<KnowledgeBaseConfig>) {
    this.config = {
      id: config?.id || 'default-kb',
      name: config?.name || 'Default Knowledge Base',
      description: config?.description || 'General domain and technical knowledge base',
      chunkSize: config?.chunkSize || 500,
      chunkOverlap: config?.chunkOverlap || 50,
      hybridAlpha: config?.hybridAlpha !== undefined ? config?.hybridAlpha : 0.5
    };
  }

  /**
   * Ingest a document and chunk it with overlap
   */
  public addDocument(docId: string, title: string, fullContent: string, metadata: Record<string, any> = {}): KnowledgeChunk[] {
    const rawChunks = this.chunkText(fullContent, this.config.chunkSize, this.config.chunkOverlap);
    const createdChunks: KnowledgeChunk[] = [];

    rawChunks.forEach((chunkContent, index) => {
      const chunkId = `${docId}#c${index + 1}`;
      const embedding = this.generateSimulatedEmbedding(chunkContent);
      const chunk: KnowledgeChunk = {
        id: chunkId,
        docId,
        title,
        content: chunkContent,
        metadata: {
          ...metadata,
          chunkIndex: index,
          totalChunks: rawChunks.length
        },
        embedding
      };
      this.chunks.set(chunkId, chunk);
      createdChunks.push(chunk);
    });

    return createdChunks;
  }

  /**
   * Query the knowledge base with hybrid search
   */
  public query(queryString: string, topK: number = 3): KnowledgeQueryResult[] {
    const queryTokens = this.tokenize(queryString);
    const queryEmbedding = this.generateSimulatedEmbedding(queryString);

    const scored: Array<{ chunk: KnowledgeChunk; score: number; matchType: 'keyword' | 'vector' | 'hybrid' }> = [];

    for (const chunk of this.chunks.values()) {
      // 1. Keyword score (BM25 / token overlap ratio)
      const chunkTokens = this.tokenize(chunk.content);
      let matchCount = 0;
      for (const token of queryTokens) {
        if (chunkTokens.includes(token)) matchCount++;
      }
      const keywordScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

      // 2. Vector similarity (Cosine similarity)
      let vectorScore = 0;
      if (chunk.embedding && queryEmbedding) {
        vectorScore = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      }

      // 3. Hybrid fusion: alpha * vector + (1 - alpha) * keyword
      const alpha = this.config.hybridAlpha;
      const hybridScore = alpha * vectorScore + (1 - alpha) * keywordScore;

      let matchType: 'keyword' | 'vector' | 'hybrid' = 'hybrid';
      if (alpha === 0) matchType = 'keyword';
      else if (alpha === 1) matchType = 'vector';

      if (hybridScore > 0.05) {
        scored.push({
          chunk,
          score: Math.min(1.0, Math.max(0.0, Number(hybridScore.toFixed(4)))),
          matchType
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    return topResults.map(item => ({
      chunk: item.chunk,
      score: item.score,
      matchType: item.matchType,
      citation: `[Source: ${item.chunk.title} (${item.chunk.id}) | Relevance: ${(item.score * 100).toFixed(1)}%]`
    }));
  }

  public getChunkCount(): number {
    return this.chunks.size;
  }

  // --- Internal NLP & Vector Utilities ---

  private chunkText(text: string, size: number, overlap: number): string[] {
    const words = text.split(/\s+/);
    if (words.length <= size) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < words.length) {
      const end = Math.min(words.length, start + size);
      chunks.push(words.slice(start, end).join(' '));
      if (end >= words.length) break;
      start += (size - overlap);
    }
    return chunks;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Generates a deterministic normalized embedding vector (32-dim) for simulation
   */
  private generateSimulatedEmbedding(text: string): number[] {
    const dim = 32;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[i % dim] += code;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, dot);
  }
}
