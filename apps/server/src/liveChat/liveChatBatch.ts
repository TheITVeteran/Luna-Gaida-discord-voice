export interface LiveChatViewerLine {
  author: string;
  text: string;
}

export function formatLiveChatBatchPrompt(messages: LiveChatViewerLine[]) {
  return messages
    .map((message) => `${message.author.trim()}: ${message.text.trim()}`)
    .join('\n');
}

export function uniqueViewerNames(messages: LiveChatViewerLine[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const key = message.author.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(message.author.trim());
  }
  return names;
}

export function liveChatBatchFlushDelayMs(
  inboxSize: number,
  batchMs: number,
  maxBatch: number
) {
  if (inboxSize >= maxBatch) return 0;
  if (inboxSize >= 2) return Math.min(200, batchMs);
  return batchMs;
}
