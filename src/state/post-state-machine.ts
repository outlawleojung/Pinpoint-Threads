import { PostState } from '@prisma/client';

// State transition rules for Post state machine (CLAUDE.md §4.1)
const TRANSITIONS: Record<PostState, PostState[]> = {
  DRAFT: ['CLASSIFYING', 'REJECTED'],
  CLASSIFYING: ['MATCHING', 'REJECTED', 'FAILED'],
  MATCHING: ['COPYWRITING', 'REJECTED', 'FAILED'],
  COPYWRITING: ['PENDING_APPROVAL', 'FAILED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CLASSIFYING', 'MATCHING', 'COPYWRITING'],
  APPROVED: ['PUBLISHING'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  REJECTED: [],
  FAILED: ['CLASSIFYING', 'MATCHING', 'COPYWRITING', 'PUBLISHING'],
};

export function canTransition(from: PostState, to: PostState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PostState, to: PostState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid post state transition: ${from} → ${to}`);
  }
}
