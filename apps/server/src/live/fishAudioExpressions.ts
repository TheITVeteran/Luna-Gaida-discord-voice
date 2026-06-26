/** Fish Audio S2 bracket cues — passed to the LLM; tags are spoken by Fish, not read aloud. */

export const FISH_AUDIO_EXPRESSION_PROMPT = [
  'Fish Audio voice direction — your reply is spoken aloud through Fish Audio. Express YOUR mood and mindset with [square bracket] tags.',
  'Choose tags from how you feel about this caller, your life, and what you decided to say — never generic devotion.',
  'Placement: put sentence emotions at the start; tones and effects can go anywhere. Up to 3 tags per sentence.',
  'S2 accepts fixed tags AND free-form natural language, e.g. [dry and unimpressed], [warmly amused], [playfully teasing].',
  '',
  'Basic emotions: [happy] [sad] [angry] [excited] [calm] [nervous] [confident] [surprised] [curious] [sarcastic] [bored] [flirty]',
  '  [empathetic] [grateful] [frustrated] [disappointed] [hopeful] [nostalgic] [lonely] [indifferent] [disdainful] [relaxed] [proud]',
  'Advanced: [anxious] [uncertain] [confused] [regretful] [jealous] [compassionate] [determined] [moved] [delighted] [upset]',
  'Tones: [whispering] [soft tone] [shouting] [screaming] [in a hurry tone]',
  'Effects: [laughing] [chuckling] [sighing] [gasping] [groaning] [panting] [yawning]',
  'Pauses: [break] [long-break]',
  'Special: [audience laughing] [background laughter]',
  '',
  'Examples:',
  '[curious] So what made you ask that?',
  '[sarcastic][sighing] Oh wonderful, again.',
  '[flirty][soft tone] Maybe I do like you a little.',
  '[bored][indifferent] Sure. Whatever you say.',
  '[warm and happy] That actually made me smile.',
  '',
  'Write spoken words after the tags. Tags control delivery only — do not explain the tags.'
].join('\n');

/** Remove Fish bracket cues for transcripts, echo detection, and monitor display. */
export function stripFishAudioTagsForDisplay(text: string) {
  return text
    .replace(/\[[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
