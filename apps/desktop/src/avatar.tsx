import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AvatarStage } from './components/AvatarStage';
import { Live2DAvatarStage } from './components/Live2DAvatarStage';
import { RealtimeClient, type CompanionState, type RealtimeEvent } from './lib/realtime';
import type { AvatarWardrobePayload } from './lib/tuziAnheiWardrobe';
import './styles/app.css';

const useLive2D = (import.meta.env.VITE_AVATAR_RENDERER ?? 'live2d') === 'live2d';

interface ExpressionCue {
  name: string;
  at: number;
}

function FloatingAvatar() {
  const client = useMemo(() => new RealtimeClient({ audioEnabled: false, role: 'avatar' }), []);
  const [state, setState] = useState<CompanionState>('idle');
  const [expressionCue, setExpressionCue] = useState<ExpressionCue>({ name: 'neutral', at: 0 });
  const [wardrobe, setWardrobe] = useState<AvatarWardrobePayload | null>(null);
  const [modelName, setModelName] = useState('AI_Maid');

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeEvent>).detail;
      if (detail.type === 'avatar.state') setState(detail.payload.state);
      if (detail.type === 'avatar.expression') {
        setExpressionCue({
          name: detail.payload.expression,
          at: detail.payload.at ?? Date.now()
        });
      }
      if (detail.type === 'avatar.wardrobe') {
        setWardrobe(detail.payload);
      }
      if (detail.type === 'avatar.model.change') setModelName(detail.payload.modelName);
    };
    client.addEventListener('event', handler);
    void client.connect().catch(() => undefined);
    return () => client.removeEventListener('event', handler);
  }, [client]);

  return (
    <div
      className="floating-shell"
      onPointerDown={() => void getCurrentWebviewWindow().startDragging()}
    >
      {useLive2D ? (
        <Live2DAvatarStage
          state={state}
          expression={expressionCue.name}
          expressionAt={expressionCue.at}
          wardrobe={wardrobe}
          floating
        />
      ) : (
        <AvatarStage
          state={state}
          expression={expressionCue.name}
          modelName={modelName}
          floating
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<FloatingAvatar />);
