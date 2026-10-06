import { parseBlogPostId } from "@/lib/config";
import { Chat } from "./chat";
import "./embed.css";

export default async function EmbedPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  const raw = Array.isArray(from) ? from[0] : from;
  const safeFrom = parseBlogPostId(raw) !== null ? raw! : null;
  return <Chat from={safeFrom} />;
}
