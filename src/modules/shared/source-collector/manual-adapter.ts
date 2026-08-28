import { createHash } from 'node:crypto';
import type { SourceAdapter, SourceCandidate, SourceCriteria } from './types.js';

/**
 * Manual Source Adapter — 사용자가 텔레그램 명령 등으로 직접 소스 URL 넣을 때 사용.
 * Phase 2~3 검증용, Phase 5부터 자동 수집 adapter로 교체 가능.
 */
export class ManualSourceAdapter implements SourceAdapter {
  readonly name = 'manual';
  private queue: SourceCandidate[] = [];

  enqueue(input: {
    sourceUrl: string;
    rawText: string;
    mediaUrls: string[];
    authorHandle?: string;
    language?: string;
    platform?: SourceCandidate['platform'];
  }): SourceCandidate {
    const hashInput = input.sourceUrl + '|' + input.mediaUrls.join(',');
    const contentHash = createHash('sha256').update(hashInput).digest('hex');
    const candidate: SourceCandidate = {
      platform: input.platform ?? 'manual',
      sourceUrl: input.sourceUrl,
      contentHash,
      rawText: input.rawText,
      mediaUrls: input.mediaUrls,
      authorHandle: input.authorHandle,
      language: input.language,
      collectedAt: new Date(),
    };
    this.queue.push(candidate);
    return candidate;
  }

  async fetch(criteria: SourceCriteria): Promise<SourceCandidate[]> {
    const limit = criteria.limit ?? this.queue.length;
    return this.queue.splice(0, limit);
  }

  size(): number {
    return this.queue.length;
  }
}

export const manualSourceAdapter = new ManualSourceAdapter();
