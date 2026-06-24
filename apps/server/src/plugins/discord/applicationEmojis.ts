export interface DiscordApplicationEmoji {
  id: string;
  name: string;
  animated?: boolean;
}

export function discordApplicationEmojiMention(emoji: DiscordApplicationEmoji) {
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

export function buildDiscordApplicationEmojiInstruction(emojis: readonly DiscordApplicationEmoji[]) {
  if (emojis.length === 0) {
    return 'No Discord application emojis are currently available. Do not invent custom emoji names or IDs.';
  }

  const available = [...emojis]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((emoji) => `- ${emoji.name}: ${discordApplicationEmojiMention(emoji)}`)
    .join('\n');

  return [
    'Prefer the available Discord application emojis over standard Unicode emoji when one naturally fits your reaction or tone.',
    'To use one, copy its complete token exactly as listed. Never output only its name, alter its name or ID, or invent an application emoji.',
    `Available Discord application emojis:\n${available}`
  ].join('\n');
}
