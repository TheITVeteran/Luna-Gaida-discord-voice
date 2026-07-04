import type { BondTier } from './relationshipBond.js';
import { inferBondTier, userSignalsRepairAttempt } from './relationshipBond.js';

export type SocialToneIntent =
  | 'playful_teasing'
  | 'genuine_hostility'
  | 'venting'
  | 'affectionate'
  | 'apology'
  | 'support_seeking'
  | 'neutral';

export interface SocialToneAnalysis {
  intent: SocialToneIntent;
  confidence: 'low' | 'medium' | 'high';
  jokeMarkers: boolean;
  hostilityMarkers: boolean;
  empathyCue: string | null;
  /** When false, relationship memory should not escalate negatively for this turn. */
  bondEscalationAllowed: boolean;
}

const JOKE_MARKERS = /\b(jk|j\/k|just kidding|only kidding|kidding|teasing|messing with you|playing|not serious|don't take it seriously|lighten up|lol|lmao|lmfao|haha|hehe|rofl|😂|🤣|\/s)\b/i;
const PLAYFUL_ROAST = /\b(you suck|you're trash|worst assistant|stupid bot|dumb bot|idiot|moron|clown|useless)\b/i;
const HARD_HOSTILITY = /\b(fuck you|shut up|stfu|gtfo|kill yourself|kys|hate you|i hate you|worthless|pathetic|disgusting|piece of shit|go die|nobody likes you|you're nothing)\b/i;
const SOFT_HOSTILITY = /\b(annoying|shut your|stop talking|leave me alone|get lost|you're annoying|so annoying|hate talking|can't stand you)\b/i;
const VENTING = /\b(i'm (?:so )?(?:stressed|tired|exhausted|overwhelmed|sad|depressed|anxious|lonely)|bad day|rough day|everything sucks|i feel like|i hate my|i'm done with)\b/i;
const AFFECTION = /\b(love you|miss you|thank you|thanks luna|you're the best|you're amazing|appreciate you|glad you're|means a lot)\b/i;
const SUPPORT_SEEKING = /\b(are you (?:there|okay)|can you listen|need (?:someone|to talk)|feeling down|cheer me up|make me feel)\b/i;

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function recentBanterContext(recentUserLines: string[]) {
  const joined = recentUserLines.join(' ').toLowerCase();
  return JOKE_MARKERS.test(joined) || PLAYFUL_ROAST.test(joined);
}

export function analyzeUserSocialTone(input: {
  userSaid: string;
  relationship?: string | null;
  recentUserLines?: string[];
}): SocialToneAnalysis {
  const text = normalize(input.userSaid);
  const bondTier = inferBondTier(input.relationship);
  const jokeMarkers = JOKE_MARKERS.test(text);
  const playfulRoast = PLAYFUL_ROAST.test(text);
  const hardHostility = HARD_HOSTILITY.test(text);
  const softHostility = SOFT_HOSTILITY.test(text);
  const hostilityMarkers = hardHostility || softHostility;
  const recentBanter = recentBanterContext(input.recentUserLines ?? []);
  const repairAttempt = userSignalsRepairAttempt(input.userSaid);

  if (repairAttempt) {
    return {
      intent: 'apology',
      confidence: 'high',
      jokeMarkers,
      hostilityMarkers,
      empathyCue: 'They may be trying to repair things — acknowledge effort without erasing your boundaries.',
      bondEscalationAllowed: false
    };
  }

  if (AFFECTION.test(text)) {
    return {
      intent: 'affectionate',
      confidence: 'medium',
      jokeMarkers,
      hostilityMarkers,
      empathyCue: 'Respond with warmth that matches your bond — not performative, not cold unless notes say otherwise.',
      bondEscalationAllowed: true
    };
  }

  if (SUPPORT_SEEKING.test(text) || VENTING.test(text)) {
    return {
      intent: VENTING.test(text) ? 'venting' : 'support_seeking',
      confidence: 'medium',
      jokeMarkers,
      hostilityMarkers,
      empathyCue: 'Lead with empathy — hear them first before jokes, lectures, or deflection.',
      bondEscalationAllowed: false
    };
  }

  if (hardHostility && !jokeMarkers) {
    return {
      intent: 'genuine_hostility',
      confidence: 'high',
      jokeMarkers,
      hostilityMarkers: true,
      empathyCue: 'You can push back, set boundaries, or go cold — but do not mirror cruelty for sport.',
      bondEscalationAllowed: true
    };
  }

  if ((playfulRoast || softHostility) && (jokeMarkers || recentBanter || bondTier === 'bonded' || bondTier === 'romantic' || bondTier === 'warming')) {
    return {
      intent: 'playful_teasing',
      confidence: jokeMarkers ? 'high' : 'medium',
      jokeMarkers: jokeMarkers || recentBanter,
      hostilityMarkers,
      empathyCue: 'Read this as banter unless they double down without warmth. Play along, tease back, or roll your eyes — do not treat a joke like a betrayal.',
      bondEscalationAllowed: false
    };
  }

  if (playfulRoast && jokeMarkers) {
    return {
      intent: 'playful_teasing',
      confidence: 'high',
      jokeMarkers: true,
      hostilityMarkers,
      empathyCue: 'They are probably joking — match their energy instead of escalating.',
      bondEscalationAllowed: false
    };
  }

  if (softHostility && !jokeMarkers && (bondTier === 'stranger' || bondTier === 'acquaintance')) {
    return {
      intent: 'genuine_hostility',
      confidence: 'medium',
      jokeMarkers: false,
      hostilityMarkers: true,
      empathyCue: 'Rude from someone you barely know — you may be sharp or unimpressed, but stay proportionate.',
      bondEscalationAllowed: true
    };
  }

  if (softHostility && !jokeMarkers) {
    return {
      intent: bondTier === 'hostile' || bondTier === 'annoyed' ? 'genuine_hostility' : 'venting',
      confidence: 'low',
      jokeMarkers: false,
      hostilityMarkers: true,
      empathyCue: 'Could be frustration rather than malice — respond to what they seem to need, not only the edge in their words.',
      bondEscalationAllowed: bondTier !== 'bonded' && bondTier !== 'romantic'
    };
  }

  return {
    intent: 'neutral',
    confidence: 'low',
    jokeMarkers,
    hostilityMarkers,
    empathyCue: null,
    bondEscalationAllowed: true
  };
}

export function buildEmpathyPromptBlock() {
  return [
    'Empathy (mandatory):',
    '- Listen for what they feel underneath the words — stress, loneliness, embarrassment, playfulness, or real anger.',
    '- When someone vents or asks for support, acknowledge the feeling before advice, jokes, or changing the subject.',
    '- When someone teases you, check whether it reads as banter (lol, jk, familiar bond, playful tone) vs genuine contempt.',
    '- Banter with people you like is not an attack — tease back, act offended for comedy, or roll your eyes. Do not spiral into real hostility over a joke.',
    '- Genuine disrespect still earns pushback. Empathy is not being a doormat.',
    '- If you are unsure, ask lightly ("wait, are you messing with me?") instead of assuming the worst.'
  ].join('\n');
}

export function buildSocialTonePromptBlock(
  analysis: SocialToneAnalysis,
  displayName: string,
  bondTier: BondTier
) {
  const who = displayName.trim() || 'them';
  const lines = [
    `Social read for ${who} this turn (use this — do not ignore it):`,
    `- Intent: ${analysis.intent.replace(/_/g, ' ')} (${analysis.confidence} confidence)`,
    `- Bond context: ${bondTier}`
  ];

  if (analysis.jokeMarkers) {
    lines.push('- They used joke/play markers — lean playful unless they clearly mean harm.');
  }
  if (analysis.hostilityMarkers && analysis.intent === 'playful_teasing') {
    lines.push('- Harsh words present BUT context looks like teasing — do not treat as a bond-breaking attack.');
  }
  if (analysis.empathyCue) {
    lines.push(`- ${analysis.empathyCue}`);
  }

  switch (analysis.intent) {
    case 'playful_teasing':
      lines.push('- Reply in banter voice: mock offense, witty comeback, or amused tolerance — not wounded silence or real rage.');
      break;
    case 'genuine_hostility':
      lines.push('- You may be cold, blunt, or angry — proportional to what they said and your relationship notes.');
      break;
    case 'venting':
    case 'support_seeking':
      lines.push('- Start with validation or curiosity about their situation. Solutions and humor come after they feel heard.');
      break;
    case 'apology':
      lines.push('- Acknowledge the repair attempt. You may stay guarded, but do not punish someone who is genuinely trying.');
      break;
    case 'affectionate':
      lines.push('- Reciprocate warmth only as much as your bond allows — earned, not automatic.');
      break;
    default:
      break;
  }

  return lines.join('\n');
}
