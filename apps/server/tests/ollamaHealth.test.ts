import { describe, expect, it } from 'vitest';
import {
  formatOllamaFetchError,
  ollamaTagsUrl,
  resolveOllamaOrigin,
} from '../src/providers/ollamaHealth.js';

describe('ollamaHealth', () => {
  it('resolves Ollama origin from OpenAI-compatible URL', () => {
    expect(resolveOllamaOrigin('http://127.0.0.1:11434/v1/chat/completions')).toBe('http://127.0.0.1:11434');
    expect(ollamaTagsUrl('http://127.0.0.1:11434/v1/chat/completions')).toBe('http://127.0.0.1:11434/api/tags');
  });

  it('formats fetch failures with a helpful message', () => {
    expect(formatOllamaFetchError(new Error('fetch failed'), 'http://127.0.0.1:11434/v1/chat/completions'))
      .toContain('Ollama is not reachable');
  });
});
