/** Discord text channels whose messages Luna reads and responds to via TTS while in voice. */

export function parseDiscordChannelIdList(raw: string | undefined) {
  if (!raw?.trim()) return [];
  return [...new Set(
    raw.split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => /^\d+$/.test(entry))
  )];
}

export function isDiscordTtsTextChannelMessage(
  messageChannelId: string,
  voiceChannelId: string,
  configuredChannelIds: readonly string[],
  options?: {
    threadParentId?: string | null;
    channelParentId?: string | null;
  }
) {
  if (messageChannelId === voiceChannelId) {
    return true;
  }
  if (options?.threadParentId === voiceChannelId || options?.channelParentId === voiceChannelId) {
    return true;
  }
  return configuredChannelIds.includes(messageChannelId);
}
