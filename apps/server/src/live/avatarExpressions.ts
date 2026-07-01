/** Shared avatar face expression names (Live2D native + generic moods). */

export const AVATAR_EXPRESSION_NAMES = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'shy',
  'blink',
  'laugh',
  'smile',
  'blush',
  'aixin',
  'lianhong',
  'liulei',
  'benghuai',
  'heilian',
  'hongguang',
  'hanzhu',
  'xingxing',
  'xueji',
  'yihuo'
] as const;

export type AvatarExpressionName = (typeof AVATAR_EXPRESSION_NAMES)[number];

export function avatarExpressionPayload(expression: string, intensity = 1) {
  return {
    expression,
    intensity: Math.min(1, Math.max(0, intensity)),
    at: Date.now()
  };
}
