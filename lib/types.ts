import type { UIMessage } from "ai";

export type Post = {
  id: number;
  url: string;
  title: string;
  prefix: string[];
  category: string;
  summary: string;
  publishedAt: string;
  modifiedAt: string;
};

export type Chunk = {
  id: string;
  postId: number;
  kind: "summary" | "body";
  headingPath: string[];
  text: string;
  embedText: string;
  hash: string;
  vector: string;
};

export type BlogIndex = {
  version: 1;
  embeddingModel: string;
  dimensions: number;
  builtAt: string;
  posts: Post[];
  chunks: Chunk[];
};

export type SourceRef = {
  n: number;
  postId: number;
  title: string;
  url: string;
  section: string;
};

export type ChatMetadata = {
  sources?: SourceRef[];
  model?: string;
  tier?: "primary" | "fallback";
};

export type ChatUIMessage = UIMessage<ChatMetadata>;
