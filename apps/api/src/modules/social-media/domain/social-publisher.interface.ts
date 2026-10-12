import { SocialPost } from './social-post.entity';

export interface PublishResult {
  externalId: string;
  publishedAt: Date;
}

export interface PostMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
}

/** Puerto que implementa cada red (Meta Graph API, LinkedIn Marketing API, TikTok Content Posting API). */
export interface SocialPublisher {
  readonly platform: SocialPost['platform'];
  publish(post: SocialPost): Promise<PublishResult>;
  fetchMetrics(externalId: string): Promise<PostMetrics>;
}

export const SOCIAL_PUBLISHERS = Symbol('SOCIAL_PUBLISHERS');
