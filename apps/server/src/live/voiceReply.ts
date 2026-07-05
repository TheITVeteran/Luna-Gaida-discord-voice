export const MAX_VOICE_SPOKEN_CHARS = 380;
export const MAX_LIVE_CHAT_SPOKEN_CHARS = 220;

/** Strip Qwen / chat-template artifacts from model output. */
export function stripModelArtifacts(text: string) {
  let result = text.trim();
  result = result.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  result = result.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
  result = result.replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '');
  result = result.replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '');
  result = result.replace(/\[Internal context — never speak or quote this\][\s\S]*?(?=(?:\n\[|$))/gi, '');
  result = result.replace(/=== BACKGROUND[\s\S]*?=== SAY NOW ===/gi, '');
  return result.trim();
}

const INTERNAL_REPLY_PATTERNS = [
  /\brelationship with .+private notes\b/i,
  /\blet this drive tone\b/i,
  /\bwhat you understand about .+ at a concept level\b/i,
  /\bwho luna is becoming\b/i,
  /\bdeep (?:web )?research\b/i,
  /\bcaller-first rule\b/i,
  /\bspoken output rule\b/i,
  /\bempathy \(mandatory\)\b/i,
  /\bsocial read for\b/i,
  /\bknown viewers in this batch\b/i,
  /\bwhat you remember about .+ \(facts only\b/i,
  /\byour (?:own )?life journal\b/i,
  /\binternal context — never speak\b/i,
  /\bprivate notes — let this drive\b/i,
  /\bcooling off after last\b/i,
  /\bmeta-testing luna\b/i,
  /\bbond context:\b/i,
  /\bintent:\s*\w+/i,
  /\bconfidence\)\b/i,
  /\bhe is caught in a loop\b/i,
  /\bhe is not yet showing\b/i,
  /\bhe is still (?:operating|trying)\b/i,
  /\bhe has not yet responded\b/i,
  /\bno flirting or pet names yet\b/i,
  /\bpolite at most — skeptical\b/i,
  /\bguarded with .+ — you are\b/i,
  /\btone:\s*you are\b/i,
  /\bthemes, projects, tastes, ongoing threads\b/i,
  /\blive web access:\b/i,
  /\bnever say you lack internet\b/i,
  /\bnever repeat aloud\b/i,
  /\bbackground \(silent\b/i,
  /\bfish audio s2 voice direction\b/i,
  /\bstage directions use \*asterisk\b/i
];

export function wrapSilentContext(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return `[Internal context — never speak or quote this]\n${trimmed}`;
}

export function buildSpokenOutputRule() {
  return [
    'Spoken output rule (mandatory):',
    '- Output ONLY the words Luna says aloud — one short natural reply.',
    '- Never output bullet lists, relationship dossiers, research summaries, tone guides, or instruction labels.',
    '- Never quote or paraphrase BACKGROUND or [Internal context] text.',
    '- Do not start with "Relationship with", "Deep research", "Tone:", "What you understand about", or "Social read".'
  ].join('\n');
}

export function buildSpokenUserTail() {
  return 'Reply with ONLY Luna\'s spoken words next. No analysis, notes, bullets, dossiers, or summaries.';
}

export function buildLunaTurnUserPrompt(parts: {
  background?: string | undefined;
  conversation?: string | undefined;
  currentMessage: string;
}) {
  return [
    parts.background?.trim()
      ? `=== BACKGROUND (silent — never repeat aloud) ===\n${parts.background.trim()}`
      : null,
    parts.conversation?.trim()
      ? `=== CONVERSATION ===\n${parts.conversation.trim()}`
      : null,
    `=== SAY NOW ===\n${parts.currentMessage.trim()}`,
    buildSpokenUserTail()
  ].filter(Boolean).join('\n\n');
}

function isInternalLeakFragment(fragment: string) {
  const trimmed = fragment.trim();
  if (!trimmed) return true;
  if (/^-\s/.test(trimmed)) return true;
  if (/^===\s/.test(trimmed)) return true;
  return INTERNAL_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function scoreSpeechLikelihood(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 8) return -100;
  if (isInternalLeakFragment(trimmed)) return -100;

  let score = 0;
  if (/^(?:\[)?(?:I|I'm|I’ve|Oh|Hey|Well|Look|So|Yeah|No|Hmm|Alright|Fine|Okay|Right|Sure|Maybe|Honestly|Solonaras)\b/i.test(trimmed)) {
    score += 4;
  }
  if (/\byou\b/i.test(trimmed)) score += 2;
  if (/\?/.test(trimmed)) score += 1;
  if (trimmed.length > 320) score -= 4;
  if ((trimmed.match(/\n\s*-\s+/g) || []).length >= +2) score -= 6;
  if (INTERNAL_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed))) score -= 8;
  return score;
}

export function looksLikeBulkPromptDump(text: string) {
  if (text.length > 500) return true;
  const bulletCount = (text.match(/(?:^|\n)\s*-\s+/g) || []).length;
  if (bulletCount >= 3) return true;
  const internalHits = INTERNAL_REPLY_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (internalHits >= 2) return true;
  return internalHits >= 1 && text.length > 180;
}

function splitSpeechCandidates(text: string) {
  return text
    .split(/\n+|(?<=[.!?])\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function extractBestSpeechSegment(text: string, maxChars: number) {
  const candidates = splitSpeechCandidates(stripModelArtifacts(text));
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreSpeechLikelihood(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return '';

  const best = ranked[0]!.candidate;
  if (best.length <= maxChars) return best;

  const quoted = best.match(/["“]([^"”]{12,}?)["”]/)?.[1];
  if (quoted && !isInternalLeakFragment(quoted)) {
    return quoted.slice(0, maxChars).trim();
  }

  return best.slice(0, maxChars).trim();
}

export function stripLeakedPromptFromReply(text: string) {
  let result = stripModelArtifacts(text);
  if (!result) return '';

  if (looksLikeBulkPromptDump(result)) {
    return extractBestSpeechSegment(result, MAX_VOICE_SPOKEN_CHARS);
  }

  const chunks = result.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (chunks.length > 1) {
    const spoken = chunks.filter((chunk) => !isInternalLeakFragment(chunk));
    if (spoken.length) {
      result = spoken.join(' ').trim();
    }
  }

  const sentences = result.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length > 1) {
    const spokenSentences = sentences.filter((sentence) => !isInternalLeakFragment(sentence));
    if (spokenSentences.length) {
      result = spokenSentences.join(' ').trim();
    }
  }

  for (const pattern of [
    /Relationship with[\s\S]*?(?=(?:[A-Z"'(]|$))/i,
    /What you understand about[\s\S]*?(?=(?:[A-Z"'(]|$))/i,
    /Deep (?:web )?research[\s\S]*?(?=(?:[A-Z"'(]|$))/i,
    /Social read for[\s\S]*?(?=(?:[A-Z"'(]|$))/i,
    /Tone:\s*you are[\s\S]*?(?=(?:[A-Z"'(]|$))/i
  ]) {
    result = result.replace(pattern, '').trim();
  }

  return result.replace(/\s{2,}/g, ' ').trim();
}

export function sanitizeVoiceReply(text: string, characterName = 'Luna') {
  let result = stripLeakedPromptFromReply(text);
  result = result.replace(/\bGiada\b/gi, characterName);
  result = result.replace(/\bgiada assistant\b/gi, characterName);
  result = result.replace(/\bblue fox girl\b/gi, characterName);

  if (!result) return '';
  if (looksLikeBulkPromptDump(result)) return '';
  if (INTERNAL_REPLY_PATTERNS.some((pattern) => pattern.test(result)) && result.length > 80) {
    return '';
  }

  return result.trim();
}

export function finalizeSpokenReply(
  raw: string,
  maxChars: number = MAX_VOICE_SPOKEN_CHARS,
  characterName = 'Luna'
) {
  const stripped = stripModelArtifacts(raw);
  if (!stripped) return '';

  const oversized = stripped.length > Math.max(600, maxChars * 2);
  if (oversized || looksLikeBulkPromptDump(stripped)) {
    const recovered = sanitizeVoiceReply(extractBestSpeechSegment(stripped, maxChars), characterName);
    if (!recovered || looksLikeBulkPromptDump(recovered)) return '';
    return recovered.length > maxChars ? recovered.slice(0, maxChars).trim() : recovered.trim();
  }

  let result = sanitizeVoiceReply(stripped, characterName);
  if (!result) return '';

  if (result.length > maxChars) {
    result = extractBestSpeechSegment(result, maxChars) || result.slice(0, maxChars).trim();
  }

  if (looksLikeBulkPromptDump(result)) return '';
  return result.trim();
}

export function isLikelyNonsenseTranscript(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (/thank you for watching|subscribe to|hello,?\s*my name is|noise suppression/.test(normalized)) return true;
  if (/^(\w+)(\s+\1){3,}/.test(normalized)) return true;
  const words = normalized.split(' ').filter(Boolean);
  if (words.length >= 5 && new Set(words).size <= 2) return true;
  return false;
}
