// TODO(Phase 2): Meta Threads Graph API 클라이언트
// Docs: https://developers.facebook.com/docs/threads

export interface ThreadsPublishInput {
  accessToken: string;
  text: string;
  mediaUrl?: string;
}

export interface ThreadsPublishResult {
  threadsPostId: string;
}

export interface ThreadsReplyInput {
  accessToken: string;
  parentId: string;
  text: string;
}

export interface ThreadsReplyResult {
  threadsReplyId: string;
}

export class ThreadsClient {
  async publish(_input: ThreadsPublishInput): Promise<ThreadsPublishResult> {
    // 2-step: Create container → Publish container
    throw new Error('ThreadsClient.publish not implemented (Phase 2)');
  }

  async reply(_input: ThreadsReplyInput): Promise<ThreadsReplyResult> {
    throw new Error('ThreadsClient.reply not implemented (Phase 2)');
  }
}
