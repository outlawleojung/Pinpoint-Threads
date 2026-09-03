// Meta Threads Graph API 클라이언트
// Docs: https://developers.facebook.com/docs/threads

import { request } from 'undici';

const GRAPH_BASE = 'https://graph.threads.net';
const AUTHORIZE_BASE = 'https://threads.net';

export const THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_read_replies',
  'threads_manage_insights',
] as const;

export interface OAuthTokenExchangeInput {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}

export interface ShortLivedToken {
  accessToken: string;
  userId: string;
}

export interface LongLivedToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface ThreadsUserProfile {
  id: string;
  username: string;
  name?: string;
  threadsProfilePictureUrl?: string;
  threadsBiography?: string;
}

export interface ThreadsPublishInput {
  accessToken: string;
  text: string;
  mediaUrls?: string[]; // 0 = text-only, 1 = single image, 2+ = carousel
}

export interface ThreadsPublishResult {
  threadsPostId: string;
}

export interface ThreadsReplyInput {
  accessToken: string;
  parentId: string;
  text: string;
  /** 첨부 이미지 URL. reply 에 이미지를 붙이면 링크 프리뷰(OG 카드)가 억제됨. */
  imageUrl?: string;
}

export interface ThreadsReplyResult {
  threadsReplyId: string;
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

export interface ThreadsInsights {
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  views?: number;
}

interface CreateContainerParams {
  mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  isCarouselItem?: boolean;
  children?: string[]; // container ids for carousel
  replyToId?: string;
  linkAttachment?: string;
}

const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_TIMEOUT_MS = 60_000;

export function buildAuthorizeUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const scopes = (input.scopes ?? THREADS_SCOPES).join(',');
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    scope: scopes,
    response_type: 'code',
    state: input.state,
  });
  return `${AUTHORIZE_BASE}/oauth/authorize?${params.toString()}`;
}

export class ThreadsClient {
  async exchangeCodeForShortLivedToken(input: OAuthTokenExchangeInput): Promise<ShortLivedToken> {
    const body = new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code: input.code,
    });

    const res = await request(`${GRAPH_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.access_token) {
      throw new Error(`Threads short-lived exchange failed: ${JSON.stringify(json)}`);
    }
    return { accessToken: json.access_token, userId: String(json.user_id) };
  }

  async exchangeShortForLongLivedToken(input: {
    appSecret: string;
    shortLivedToken: string;
  }): Promise<LongLivedToken> {
    const params = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: input.appSecret,
      access_token: input.shortLivedToken,
    });

    const res = await request(`${GRAPH_BASE}/access_token?${params.toString()}`, {
      method: 'GET',
    });

    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.access_token) {
      throw new Error(`Threads long-lived exchange failed: ${JSON.stringify(json)}`);
    }
    return {
      accessToken: json.access_token,
      tokenType: json.token_type ?? 'bearer',
      expiresIn: Number(json.expires_in ?? 5184000),
    };
  }

  async refreshLongLivedToken(input: { accessToken: string }): Promise<LongLivedToken> {
    const params = new URLSearchParams({
      grant_type: 'th_refresh_token',
      access_token: input.accessToken,
    });

    const res = await request(`${GRAPH_BASE}/refresh_access_token?${params.toString()}`, {
      method: 'GET',
    });

    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.access_token) {
      throw new Error(`Threads refresh failed: ${JSON.stringify(json)}`);
    }
    return {
      accessToken: json.access_token,
      tokenType: json.token_type ?? 'bearer',
      expiresIn: Number(json.expires_in ?? 5184000),
    };
  }

  /**
   * 계정 팔로워 수 조회 (User Insights API).
   * Docs: https://developers.facebook.com/docs/threads/insights
   * 필요 scope: threads_manage_insights (이미 요청됨).
   * 응답: { data: [{ name: 'followers_count', total_value: { value: N } }] }
   */
  async fetchFollowersCount(accessToken: string): Promise<number> {
    const params = new URLSearchParams({
      metric: 'followers_count',
      access_token: accessToken,
    });
    const res = await request(`${GRAPH_BASE}/v1.0/me/threads_insights?${params.toString()}`, {
      method: 'GET',
    });
    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !Array.isArray(json.data)) {
      throw new Error(`Threads followers_count fetch failed: ${res.statusCode} ${JSON.stringify(json)}`);
    }
    const entry = json.data.find((d: any) => d.name === 'followers_count');
    const value = entry?.total_value?.value;
    if (typeof value !== 'number') {
      throw new Error(`Threads followers_count: value missing: ${JSON.stringify(json)}`);
    }
    return value;
  }

  /**
   * 가장 오래된 게시글 timestamp 조회 (계정 나이 근사).
   * `GET /me/threads?fields=id,timestamp&limit=100` 로 페이지 순회 · 마지막 페이지 마지막 아이템 = 가장 오래된.
   * 게시글이 하나도 없으면 null.
   */
  async fetchOldestThreadTimestamp(accessToken: string): Promise<Date | null> {
    let oldest: Date | null = null;
    let url = `${GRAPH_BASE}/v1.0/me/threads?${new URLSearchParams({
      fields: 'id,timestamp',
      limit: '100',
      access_token: accessToken,
    }).toString()}`;

    for (let page = 0; page < 20; page++) { // 최대 2000건 (100 x 20)
      const res = await request(url, { method: 'GET' });
      const json = (await res.body.json()) as any;
      if (res.statusCode !== 200 || !Array.isArray(json.data)) {
        throw new Error(`Threads oldest post fetch failed: ${res.statusCode} ${JSON.stringify(json).slice(0, 200)}`);
      }
      for (const item of json.data) {
        const ts = item.timestamp ? new Date(item.timestamp) : null;
        if (ts && !Number.isNaN(ts.getTime())) {
          if (!oldest || ts.getTime() < oldest.getTime()) oldest = ts;
        }
      }
      const next: string | undefined = json.paging?.next;
      if (!next) break;
      url = next;
    }
    return oldest;
  }

  async fetchUserProfile(accessToken: string): Promise<ThreadsUserProfile> {
    const fields = 'id,username,name,threads_profile_picture_url,threads_biography';
    const params = new URLSearchParams({ fields, access_token: accessToken });

    const res = await request(`${GRAPH_BASE}/v1.0/me?${params.toString()}`, { method: 'GET' });

    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.id) {
      throw new Error(`Threads user profile fetch failed: ${JSON.stringify(json)}`);
    }
    return {
      id: String(json.id),
      username: String(json.username),
      name: json.name,
      threadsProfilePictureUrl: json.threads_profile_picture_url,
      threadsBiography: json.threads_biography,
    };
  }

  private async createContainer(
    accessToken: string,
    params: CreateContainerParams,
  ): Promise<string> {
    const body = new URLSearchParams({ access_token: accessToken });
    if (params.mediaType) body.set('media_type', params.mediaType);
    if (params.text !== undefined) body.set('text', params.text);
    if (params.imageUrl) body.set('image_url', params.imageUrl);
    if (params.videoUrl) body.set('video_url', params.videoUrl);
    if (params.isCarouselItem) body.set('is_carousel_item', 'true');
    if (params.children?.length) body.set('children', params.children.join(','));
    if (params.replyToId) body.set('reply_to_id', params.replyToId);
    if (params.linkAttachment) body.set('link_attachment', params.linkAttachment);

    const res = await request(`${GRAPH_BASE}/v1.0/me/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.id) {
      throw new Error(`Threads createContainer failed: ${res.statusCode} ${JSON.stringify(json)}`);
    }
    return String(json.id);
  }

  private async getContainerStatus(
    accessToken: string,
    containerId: string,
  ): Promise<{ status: ContainerStatus; errorMessage?: string }> {
    const params = new URLSearchParams({
      fields: 'status,error_message',
      access_token: accessToken,
    });
    const res = await request(`${GRAPH_BASE}/v1.0/${containerId}?${params.toString()}`, {
      method: 'GET',
    });
    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200) {
      throw new Error(`Threads status check failed: ${res.statusCode} ${JSON.stringify(json)}`);
    }
    return { status: json.status as ContainerStatus, errorMessage: json.error_message };
  }

  private async waitForContainerReady(accessToken: string, containerId: string): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < CONTAINER_POLL_TIMEOUT_MS) {
      const { status, errorMessage } = await this.getContainerStatus(accessToken, containerId);
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Threads container ${containerId} ${status}: ${errorMessage ?? ''}`);
      }
      await sleep(CONTAINER_POLL_INTERVAL_MS);
    }
    throw new Error(`Threads container ${containerId} did not finish within ${CONTAINER_POLL_TIMEOUT_MS}ms`);
  }

  private async publishContainer(accessToken: string, containerId: string): Promise<string> {
    const body = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    });
    const res = await request(`${GRAPH_BASE}/v1.0/me/threads_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200 || !json.id) {
      throw new Error(`Threads publish failed: ${res.statusCode} ${JSON.stringify(json)}`);
    }
    return String(json.id);
  }

  async publish(input: ThreadsPublishInput): Promise<ThreadsPublishResult> {
    const { accessToken, text, mediaUrls = [] } = input;
    let containerId: string;

    // URL 패턴으로 image/video 자동 판정 (.mp4 · Cloudinary /video/upload/)
    const kindOf = (u: string): 'IMAGE' | 'VIDEO' =>
      /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/') ? 'VIDEO' : 'IMAGE';

    if (mediaUrls.length === 0) {
      containerId = await this.createContainer(accessToken, { mediaType: 'TEXT', text });
    } else if (mediaUrls.length === 1) {
      const kind = kindOf(mediaUrls[0]!);
      containerId = await this.createContainer(accessToken, {
        mediaType: kind,
        text,
        ...(kind === 'VIDEO' ? { videoUrl: mediaUrls[0] } : { imageUrl: mediaUrls[0] }),
      });
      await this.waitForContainerReady(accessToken, containerId);
    } else {
      const childIds: string[] = [];
      for (const url of mediaUrls) {
        const kind = kindOf(url);
        const childId = await this.createContainer(accessToken, {
          mediaType: kind,
          ...(kind === 'VIDEO' ? { videoUrl: url } : { imageUrl: url }),
          isCarouselItem: true,
        });
        childIds.push(childId);
      }
      for (const id of childIds) {
        await this.waitForContainerReady(accessToken, id);
      }
      containerId = await this.createContainer(accessToken, {
        mediaType: 'CAROUSEL',
        text,
        children: childIds,
      });
      await this.waitForContainerReady(accessToken, containerId);
    }

    const publishedId = await this.publishContainer(accessToken, containerId);
    return { threadsPostId: publishedId };
  }

  /**
   * 게시글 insights 회수.
   * Docs: GET /v1.0/{threads-media-id}/insights?metric=views,likes,replies,reposts,quotes
   * threads_manage_insights 권한 필요.
   */
  async fetchInsights(input: {
    accessToken: string;
    threadsPostId: string;
  }): Promise<ThreadsInsights> {
    const metrics = ['views', 'likes', 'replies', 'reposts', 'quotes'].join(',');
    const params = new URLSearchParams({
      metric: metrics,
      access_token: input.accessToken,
    });
    const res = await request(
      `${GRAPH_BASE}/v1.0/${input.threadsPostId}/insights?${params.toString()}`,
      { method: 'GET' },
    );
    const json = (await res.body.json()) as any;
    if (res.statusCode !== 200) {
      throw new Error(`insights fetch failed: HTTP ${res.statusCode} ${JSON.stringify(json)}`);
    }
    const out: ThreadsInsights = {};
    // 응답 형식: { data: [{ name: 'views', values: [{ value: 123 }] }, ...] }
    for (const m of json.data ?? []) {
      const name = String(m.name ?? '') as keyof ThreadsInsights;
      const val = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
      if (name && ['likes', 'replies', 'reposts', 'quotes', 'views'].includes(name)) {
        (out as any)[name] = val;
      }
    }
    return out;
  }

  async reply(input: ThreadsReplyInput): Promise<ThreadsReplyResult> {
    // 이미지 첨부 시 IMAGE 컨테이너 · 없으면 TEXT
    // (Threads 는 reply 에 이미지가 붙으면 링크 프리뷰 OG 카드를 자동 억제.)
    const containerId = input.imageUrl
      ? await this.createContainer(input.accessToken, {
          mediaType: 'IMAGE',
          text: input.text,
          imageUrl: input.imageUrl,
          replyToId: input.parentId,
        })
      : await this.createContainer(input.accessToken, {
          mediaType: 'TEXT',
          text: input.text,
          replyToId: input.parentId,
        });
    const publishedId = await this.publishContainer(input.accessToken, containerId);
    return { threadsReplyId: publishedId };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
