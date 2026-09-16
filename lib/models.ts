import { ZEN_MODELS } from './zencreator-models';
import type { Kind } from './domain';
export const MODELS: {
  id: string;
  name: string;
  provider: string;
  kind: Kind;
  estimate: string | null;
  note: string;
}[] = [
  ...ZEN_MODELS,
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'openai',
    kind: 'text',
    estimate: null,
    note: 'Сценарии, характеры и сцены; оплата по токенам',
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    provider: 'xai',
    kind: 'text',
    estimate: null,
    note: 'Сценарии, характеры, режиссерские правки',
  },
  {
    id: 'MiniMax-M2.7',
    name: 'MiniMax M2.7',
    provider: 'minimax',
    kind: 'text',
    estimate: null,
    note: 'Альтернативные сценарии и диалоги',
  },
  {
    id:'gpt-image-2.5-sunburst', name:'GPT Image 2.5 Sunburst',provider:'openai',kind:'image',estimate:null,
    note:'Точные образы и правки; high; до 8 референсов по 10 МБ, суммарно 20 МБ; оплата по токенам',
  },
  {
    id:'gpt-image-2.5-flare',name:'GPT Image 2.5 Flare',provider:'openai',kind:'image',estimate:null,
    note:'Быстрые варианты образов; high; до 8 референсов по 10 МБ, суммарно 20 МБ; оплата по токенам',
  },
  {
    id: 'grok-imagine-image-2.0',
    name: 'Grok Imagine Image 2.0',
    provider: 'xai',
    kind: 'image',
    estimate: '400000000',
    note: '1K, low; $0.04 + $0.01 за референс',
  },
  {
    id: 'flux-2-pro',
    name: 'FLUX.2 Pro',
    provider: 'bfl',
    kind: 'image',
    estimate: null,
    note: 'До 8 референсов; общий лимит входных и выходного изображений — 9 МП',
  },
  {
    id: 'image-01', name: 'MiniMax image-01', provider: 'minimax', kind: 'image',
    estimate: '35000000',
    note: 'Одна картинка · $0.0035; компактный промпт до 1500 символов; референсы PNG/JPEG меньше 10 МБ',
  },
  {
    id: 'grok-imagine-video-1.5',
    name: 'Grok Imagine Video 1.5',
    provider: 'xai',
    kind: 'video',
    estimate: '8500000000',
    note: '720p, 6 сек, первый кадр; ориентир $0.85',
  },
  {
    id: 'MiniMax-Hailuo-2.3',
    name: 'MiniMax Hailuo 2.3',
    provider: 'minimax',
    kind: 'video',
    estimate: null,
    note: '768p, 6 сек; команды движения камеры',
  },
  {
    id: 'MiniMax-H3', name: 'MiniMax H3 (Hailuo)', provider: 'minimax', kind: 'video',
    estimate: '4800000000',
    note: '768p, 6 сек; выбранный первый кадр и движение камеры; ориентир $0.48; нужен ключ Pay-as-you-go',
  },
  {
    id: 'eleven_v3',
    name: 'ElevenLabs v3',
    provider: 'elevenlabs',
    kind: 'audio',
    estimate: null,
    note: 'Требуется voice_id из вашего аккаунта',
  },
  {
    id: 'speech-2.8-hd',
    name: 'MiniMax Speech 2.8 HD',
    provider: 'minimax',
    kind: 'audio',
    estimate: null,
    note: 'Русская речь; требуется voice_id',
  },
];
// Processing models are deliberately separate from text/image/video generation.
export const SYNC_MODELS = [
  { id: 'sync-3', name: 'Sync · sync-3', provider: 'sync', kind: 'video' as const, estimate: null,
    note: 'Может оживлять закрытые губы; анимацию сначала проверьте на одном плане', rate: '0.133' },
  { id: 'lipsync-2', name: 'Sync · lipsync-2', provider: 'sync', kind: 'video' as const, estimate: null,
    note: 'Нужно видимое естественное движение рта в исходном видео', rate: '0.05' },
  { id: 'lipsync-2-pro', name: 'Sync · lipsync-2-pro', provider: 'sync', kind: 'video' as const, estimate: null,
    note: 'Больше деталей лица; рот в исходном видео уже должен двигаться', rate: '0.08325' },
];
export const PROVIDERS = [
  {id:'zencreator',name:'ZenCreator · агрегатор',url:'https://app.zencreator.pro/api-keys'},
  { id: 'openai', name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
  { id: 'xai', name: 'xAI / Grok', url: 'https://console.x.ai/' },
  { id: 'minimax', name: 'MiniMax', url: 'https://platform.minimax.io/' },
  {
    id: 'bfl',
    name: 'Black Forest Labs / FLUX',
    url: 'https://dashboard.bfl.ai/',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    url: 'https://elevenlabs.io/app/settings/api-keys',
  },
  { id: 'sync', name: 'sync.so · синхронизация губ', url: 'https://sync.so/' },
];
export function model(id: string) {
  const m = [...MODELS, ...SYNC_MODELS].find((m) => m.id === id);
  if (!m) throw new Error('Модель не поддерживается.');
  return m;
}
