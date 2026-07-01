import { spawn } from 'node:child_process';
import type { AppConfig } from '../config/env.js';

const DEFAULT_OLLAMA_ORIGIN = 'http://127.0.0.1:11434';

export function resolveOllamaOrigin(apiUrl: string) {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return DEFAULT_OLLAMA_ORIGIN;
  }
}

export function ollamaTagsUrl(apiUrl: string) {
  return `${resolveOllamaOrigin(apiUrl)}/api/tags`;
}

export async function pingOllama(tagsUrl: string, timeoutMs = 2_500) {
  try {
    const response = await fetch(tagsUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export function wakeOllamaProcess() {
  try {
    const child = spawn('ollama', ['list'], {
      shell: process.platform === 'win32',
      stdio: 'ignore',
      detached: true,
    });
    child.unref?.();
  } catch {
    // Ollama CLI may not be on PATH; caller will retry ping only.
  }
}

export async function ensureOllamaReady(
  config: AppConfig,
  options: { maxWaitMs?: number; wakeIfDown?: boolean } = {},
) {
  const maxWaitMs = options.maxWaitMs ?? 25_000;
  const wakeIfDown = options.wakeIfDown ?? true;
  const tagsUrl = ollamaTagsUrl(config.ollamaApiUrl);

  if (await pingOllama(tagsUrl)) {
    return true;
  }

  if (wakeIfDown) {
    wakeOllamaProcess();
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(2_000);
    if (await pingOllama(tagsUrl)) {
      return true;
    }
  }

  return false;
}

export function formatOllamaFetchError(error: unknown, apiUrl: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|AbortError|timed out/i.test(message)) {
    const origin = resolveOllamaOrigin(apiUrl);
    return `Ollama is not reachable at ${origin}. Start the Ollama app or run \`ollama serve\`, then restart Luna.`;
  }
  return message;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
