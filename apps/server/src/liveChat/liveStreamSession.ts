/** Tracks one YouTube live broadcast — viewers Luna spoke with, intro/outro timing. */

export interface LiveStreamSessionState {
  videoId: string;
  startedAt: number;
  introDone: boolean;
  outroDone: boolean;
  viewers: string[];
}

export class YoutubeLiveStreamSession {
  readonly videoId: string;
  readonly startedAt: number;
  private readonly viewers = new Set<string>();
  introDone = false;
  outroDone = false;
  private outroTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(videoId: string, startedAt = Date.now()) {
    this.videoId = videoId;
    this.startedAt = startedAt;
  }

  noteViewers(names: Iterable<string>) {
    for (const raw of names) {
      const name = raw.trim();
      if (name) this.viewers.add(name);
    }
  }

  getViewers(): string[] {
    return [...this.viewers];
  }

  elapsedMs(now = Date.now()) {
    return Math.max(0, now - this.startedAt);
  }

  elapsedMinutes(now = Date.now()) {
    return Math.round(this.elapsedMs(now) / 60_000);
  }

  scheduleOutro(afterMs: number, callback: () => void) {
    this.clearOutroTimer();
    this.outroTimer = setTimeout(() => {
      this.outroTimer = null;
      callback();
    }, afterMs);
    this.outroTimer.unref?.();
  }

  clearOutroTimer() {
    if (this.outroTimer) {
      clearTimeout(this.outroTimer);
      this.outroTimer = null;
    }
  }

  snapshot(): LiveStreamSessionState {
    return {
      videoId: this.videoId,
      startedAt: this.startedAt,
      introDone: this.introDone,
      outroDone: this.outroDone,
      viewers: this.getViewers()
    };
  }
}

export function formatViewerRollCall(viewers: string[], maxNamed = 12): string {
  if (!viewers.length) {
    return 'everyone who stopped by in chat';
  }
  const named = viewers.slice(0, maxNamed);
  const rest = viewers.length - named.length;
  if (rest > 0) {
    return `${named.join(', ')}, and ${rest} others who chatted`;
  }
  return named.join(', ');
}

export function shouldSkipIntro(session: YoutubeLiveStreamSession | null, videoId: string) {
  return Boolean(session && session.videoId === videoId && session.introDone);
}
