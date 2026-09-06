/**
 * LLM 프로바이더 공통 인터페이스.
 * Anthropic Claude / Google Gemini 등 교체 가능.
 * env.LLM_PROVIDER로 결정.
 */

export type LlmModelTier = 'fast' | 'main';   // fast = 필터/분류 (저비용), main = 카피/Vision (고품질)

export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmImagePart {
  type: 'image';
  url: string;   // 공개 접근 가능 URL
}

export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmCompletionInput {
  tier: LlmModelTier;
  system?: string;
  userParts: LlmContentPart[];
  maxOutputTokens?: number;
  temperature?: number;
  jsonMode?: boolean;   // true면 JSON 응답 강제
  jsonSchema?: unknown; // Gemini responseSchema (Vertex AI OpenAPI 3.0 스타일)
  /**
   * 확장 사고(extended thinking) 제어. claude-sonnet-5는 기본 ON이라
   * thinking 블록이 max_tokens 예산을 잠식해 긴 JSON 출력을 잘라먹을 수 있다.
   * 긴 구조화 출력엔 'disabled' 권장. 미지정 시 모델/서버 기본값.
   */
  thinking?: 'disabled';
}

export interface LlmCompletionResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
  provider: 'anthropic' | 'gemini';
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'gemini';
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
}
