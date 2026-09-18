'use client';
import { isFalImage, falRefIssue, FAL_PROMPT_BUDGET } from '@/lib/fal-models';
import { scriptReapprovalReason } from '@/lib/script-approval';
import { storyboardReapprovalReason } from '@/lib/storyboard-approval';
import { runnableJobs, newestProject, storyboardAdmissionIssue } from '@/lib/generation-queue';
import { hiddenReferences, selectedReferences } from '@/lib/reference-selection';
import { zenCredits, generationSeconds, isZenCreatorImage, ZEN_IMAGE_PROMPT_LIMIT } from '@/lib/zencreator-models';
import { useEffect, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Film,
  Plus,
  ArrowRight,
  Upload,
  Wallet,
  Settings2,
  Check,
  Lock,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Download,
  Sparkles,
  Loader2,
  FolderOpen,
  Library,
  Image as ImageIcon,
  Clapperboard,
  Mic,
  Clock,
  RefreshCw,
  X,
  FileText,
  ExternalLink,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  STAGES,
  chosen,
  dependencies,
  variantCurrent,
  isApproved,
  itemStatus,
  stageReady,
  totals,
  money,
  ticks,
  type Project,
  type Variant,
  type Item,
  type Kind,
  type CharacterBrief,
} from '@/lib/domain';
import { approvedCharacters, characterImageRefs, withCharacterIdentity, videoCharacterRefs } from '@/lib/characters';
import { MODELS, PROVIDERS, SYNC_MODELS } from '@/lib/models';
import { lipsyncSource, lipsyncImageSource, lipsyncImagePrompt, lipsyncEstimate, originalLipsyncVideo, SYNC_IMAGE_PROMPT_LIMIT } from '@/lib/lipsync';
import { uploadAsset } from '@/lib/asset-upload';
import { prepareLipsyncMedia, prepareLipsyncImage } from '@/lib/lipsync-media';
import { approvalBatch, changedSpeechSelections, approveSelectedSpeech } from '@/lib/bulk-approval';
import { approvalBlockers } from '@/lib/approval-blockers';
import { videoReapprovalReason } from '@/lib/video-approval';
import { styleReapprovalReason } from '@/lib/style-approval';
import { speechReapprovalReason } from '@/lib/speech-approval';
import { planCardsNeedSync } from '@/lib/plan-sync';
import { storyboardImageRequest, storyboardImagePromptIssue } from '@/lib/storyboard-image-prompt';
import { isMiniMaxImage, miniMaxImageRequest, compactImageRequest, miniMaxImageRefIssue } from '@/lib/minimax-image';
import { canArchiveJob, journalArchived, newestJobs } from '@/lib/journal';
import { isOpenAIImage, openAIImageTariff } from '@/lib/openai-image';
import { readableText } from '@/lib/shots';
import { initialSpeech, scriptSpeech, speechCharacters, speechPlans } from '@/lib/speech';
import { participates } from '@/lib/domain';
import type { VoiceOption } from '@/lib/voices';
import { spokenText } from '@/lib/spoken-text';
import { scriptVideo, videoShot, videoPrompt, videoGenerationPrompt, videoFrame, videoFrameOptions, VIDEO_PROMPT_LIMIT, selectedVideoModel, remainingVideoPlans } from '@/lib/video';
import { planSpeech } from '@/lib/plan-speech';
import { speechInfo, speechNames, speechDirection, type SpeechInfo } from '@/lib/speech-mode';
import { renderFilm, editPlan, fitPlanToSpeech } from '@/lib/render';
import { audioDuration } from '@/lib/audio-duration';
import { planFields, storyboardPrompt, storyboardBatchPlans } from '@/lib/storyboard';
import { animaticBasis, animaticIssue, animaticApproved } from '@/lib/animatic';
import { WORKFLOW, stageTitle, nextStage, workflowReady, stageComplete } from '@/lib/workflow';
type Asset = { id: string; name: string; mime: string; size: number };
type Summary = { id: string; title: string; updated: string };
async function request(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<any> {
  const r = await fetch(url, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : body
          ? { 'content-type': 'application/json' }
          : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || 'Не удалось выполнить действие.');
  return d;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Drop({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue>
          {options.find((o) => o.value === value)?.label || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Media({ v }: { v: Variant }) {
  const [audioSeconds, setAudioSeconds] = useState(0);
  if (!v.assetId) return null;
  const url = '/api/assets/' + v.assetId;
  return v.kind === 'image' ? (
    <img className="variant-image" src={url} alt={v.title} />
  ) : v.kind === 'video' ? (
    <video className="variant-video" controls preload="metadata" src={url} />
  ) : v.kind === 'audio' ? (
    <div className="audio-wrap">
      <Mic />
      <audio controls preload="metadata" src={url} onLoadedMetadata={e => setAudioSeconds(e.currentTarget.duration)} />
      {v.shotSource && audioSeconds > 0 && <small>Запись: {audioSeconds.toFixed(1)} сек. На момент создания план: {v.duration} сек.
        {audioSeconds - v.trim > v.duration + 0.05 && ' При сборке план автоматически продлится до конца реплики. В финальном фильме используется доступная часть видеоролика; её длина проверяется перед монтажом.'}</small>}
    </div>
  ) : null;
}
const kindNames: Record<Kind, string> = {
  text: 'Текст',
  image: 'Изображение',
  audio: 'Голос / музыка',
  video: 'Видео',
};
const statuses: Record<string, string> = {
  queued: 'В очереди',
  dispatching: 'Генерация',
  pending: 'Обработка у провайдера',
  saving: 'Сохранение файла',
  done: 'Готово',
  failed: 'Ошибка',
  unknown: 'Исход неизвестен',
  cancelled: 'Отменено',
};
export default function Studio() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const activeProject = useRef('');
  const projectEpoch = useRef(0);
  const uploads = useRef(new Set<AbortController>());
  const [step, setStep] = useState(0);
  const [itemId, setItemId] = useState('');
  const [panel, setPanel] = useState<
    'stage' | 'budget' | 'connections' | 'library'
  >('stage');
  const [dialog, setDialogState] = useState<string | null>(null);
  const dialogEpoch = useRef(0);
  const openedDialogEpoch = dialogEpoch.current;
  function setDialog(value: string | null) {
    dialogEpoch.current++;
    setDialogState(value);
  }
  const closeDialog = () => {
    if (activeProject.current === projectId && dialogEpoch.current === openedDialogEpoch) setDialog(null);
  };
  const [voiceView,setVoiceView]=useState('plans');
  const [characterTarget,setCharacterTarget] = useState<string>();
  const [editing, setEditing] = useState<Variant | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [renderStatus, setRenderStatus] = useState('');
  const renderAbort = useRef<AbortController | null>(null);
  const jobFlights = useRef(new Map<string,Set<string>>());
  const jobAttempts = useRef(new Map<string,Map<string,number>>());
  const videoSyncAttempt = useRef('');
  const storyboardSyncAttempt = useRef('');
  const projects = useQuery<Summary[]>({
    queryKey: ['projects'],
    queryFn: () => request('/api/projects'),
  });
  useEffect(() => {
    if (!projectId && projects.data?.length) switchProject(projects.data[0].id);
  }, [projects.data, projectId]);
  const pq = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => request('/api/projects/' + projectId),
    enabled: !!projectId,
  });
  const p = pq.data;
  const aq = useQuery<Asset[]>({
    queryKey: ['assets', projectId],
    queryFn: () => request('/api/assets?projectId=' + encodeURIComponent(projectId)),
    enabled: !!projectId,
  });
  const cq = useQuery<any>({
    queryKey: ['connections'],
    queryFn: () => request('/api/connections'),
  });
  const assets = aq.data ?? [];
  const group = p?.items.filter((i) => i.stage === step&&!i.removedAt&&!i.planArchive&&(step!==6||participates(p,i))).map(i=>step===6?{...i,variants:i.variants.filter(v=>v.kind!=='video')}:i) ?? [];
  const item = group.find((i) => i.id === itemId) ?? group[0];
  const selected = item && chosen(item);
  const balance = p ? totals(p) : { actual: '0', reserved: '0', unknown: 0 };
  const ready = p ? workflowReady(p, step) : false;
  const blockers = p && !ready ? approvalBlockers(p, step===9?6:step) : [];
  const showCards=step!==9&&(step!==6||voiceView==='plans');
  const selectedApproved = !!(p && item && selected && item.approvedId === selected.id && isApproved(p, item));
  const staleScript=!!(p&&item&&step===4&&selected&&!variantCurrent(p,item,selected));
  const scriptReason=p&&item&&selected&&staleScript?scriptReapprovalReason(p,item.id,selected.id):'';
  const staleStoryboard=!!(p&&item&&step===5&&selected&&!variantCurrent(p,item,selected));
  const storyboardReason=p&&item&&selected&&staleStoryboard?storyboardReapprovalReason(p,item.id,selected.id):'';
  const staleVideo = !!(p && step === 7 && selected?.kind === 'video' && selected.assetId && selected.deps !== dependencies(p, 7));
  const reapprovalReason = p && item && selected && staleVideo ? videoReapprovalReason(p, item.id, selected.id) : '';
  const staleStyle=!!(p&&item&&step===2&&selected&&!variantCurrent(p,item,selected));
  const styleReason=p&&item&&selected&&staleStyle?styleReapprovalReason(p,item.id,selected.id):'';
  const staleSpeech=!!(p&&step===6&&selected?.kind==='audio'&&selected.assetId&&selected.deps!==dependencies(p,6));
  const speechReason=p&&item&&selected&&staleSpeech?speechReapprovalReason(p,item.id,selected.id):'';
  const videoScript = p ? scriptVideo(p) : undefined;
  const currentShot = p && item && [5, 7].includes(step) ? videoShot(p, item) : undefined;
  function replace(next: Project) {
    qc.setQueryData<Project>(['project', next.id],previous=>newestProject(previous,next));
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['assets', next.id] });
  }
  function switchProject(id: string) {
    if (activeProject.current !== id) {
      projectEpoch.current++;
      activeProject.current = id;
      renderAbort.current?.abort();
      for (const controller of uploads.current) controller.abort();
      uploads.current.clear();
      setBusy(false);
      setError('');
      setRenderStatus('');
      setEditing(undefined);
      setCharacterTarget(undefined);
      setDraft('');
      setVoiceView('plans');
    }
    setProjectId(id);
    setDialog(null);
    setStep(0);
    setPanel('stage');
    setItemId('');
  }
  async function action(name: string, data?: unknown, target = item?.id) {
    if (!p) throw new Error('Откройте проект.');
    const epoch = projectEpoch.current;
    const next = await request('/api/projects/' + p.id, 'PATCH', {
      revision: p.revision,
      action: name,
      itemId: target,
      data,
    });
    replace(next);
    if (epoch !== projectEpoch.current) throw new Error('Проект сменился во время сохранения.');
    return next as Project;
  }
  async function perform(fn: () => Promise<unknown>) {
    const epoch = projectEpoch.current;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (epoch !== projectEpoch.current) return;
      setError(e instanceof Error ? e.message : String(e));
      if (projectId) qc.invalidateQueries({ queryKey: ['project', projectId] });
    } finally {
      if (epoch === projectEpoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!p || ![5, 7].includes(step) || busy || !videoScript?.variant ||
      p.jobs.some(j => ['queued', 'dispatching', 'pending', 'saving'].includes(j.status))) return;
    const key = `${p.id}:${videoScript.variant.id}`;
    const attempt = step === 5 ? storyboardSyncAttempt : videoSyncAttempt;
    const missing = planCardsNeedSync(p,step,videoScript);
    if (!missing || attempt.current === key) return;
    attempt.current = key;
    void perform(() => action(step === 5 ? 'prepareShots' : 'syncVideoPlans'));
  }, [p, step, busy]);
  useEffect(() => {
    if (!projectId) return;
    const flights=jobFlights.current.get(projectId)??new Set<string>();
    const attempts=jobAttempts.current.get(projectId)??new Map<string,number>();
    jobFlights.current.set(projectId,flights);jobAttempts.current.set(projectId,attempts);
    const timer = setInterval(() => {
      const current = qc.getQueryData<Project>(['project', projectId]);
      if(!current)return;
      for(const job of runnableJobs(current,flights,attempts)) {
        flights.add(job.id);attempts.set(job.id,Date.now());
        void (async()=>{
          try {
            const next=await request(`/api/projects/${projectId}/jobs/${job.id}`,'POST');
            qc.setQueryData<Project>(['project',projectId],previous=>newestProject(previous,next));
            qc.invalidateQueries({queryKey:['assets',projectId]});
          } catch(e) {
            if(activeProject.current===projectId)setError(e instanceof Error?e.message:'Не удалось проверить задачу.');
          } finally {flights.delete(job.id);}
        })();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [projectId, qc]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    const register = (tool: any) =>
      Promise.resolve(
        context.registerTool(tool, { signal: life.signal }),
      ).catch(() => {});
    register({
      name: 'read_film_project',
      title: 'Состояние фильма',
      description:
        'Прочитать проект, варианты, утверждения и расходы без изменений.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        qc.getQueryData(['project', projectId]) ?? {
          error: 'Проект не открыт',
        },
    });
    register({
      name: 'open_film_stage',
      title: 'Открыть этап фильма',
      description:
        'Открыть этап 1–10 в режиссерской студии; ничего не утверждает и не генерирует.',
      inputSchema: {
        type: 'object',
        properties: { stage: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['stage'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input: any) => {
        if (
          !Number.isInteger(input?.stage) ||
          input.stage < 1 ||
          input.stage > 10
        )
          throw new Error('Этап должен быть от 1 до 10.');
        setStep(WORKFLOW[input.stage-1].id);
        setPanel('stage');
        return { stage: input.stage, title: WORKFLOW[input.stage - 1].title };
      },
    });
    return () => life.abort();
  }, [projectId, qc]);
  async function upload(file: File, progress?: (text: string) => void, signal?: AbortSignal) {
    if (!projectId || activeProject.current !== projectId) throw new Error('Откройте проект перед загрузкой.');
    const epoch = projectEpoch.current;
    const controller = new AbortController();
    uploads.current.add(controller);
    try {
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const a = await uploadAsset(file, projectId, progress, combined);
      qc.invalidateQueries({ queryKey: ['assets', projectId] });
      if (projectEpoch.current !== epoch) throw new Error('Проект сменился во время загрузки.');
      return a as Asset;
    } finally { uploads.current.delete(controller); }
  }
  async function assemble(animatic: boolean) {
    if (!p) return;
    const controller = new AbortController(), epoch = projectEpoch.current;
    renderAbort.current = controller;
    const report = (text: string) => { if (projectEpoch.current === epoch && renderAbort.current === controller) setRenderStatus(text); };
    let downloaded = false;
    try {
      const basis=animatic?animaticBasis(p):undefined;
      const { blob, seconds, timing } = await renderFilm(
        p,
        animatic,
        report,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      download(blob, `${p.title}${animatic ? ' — аниматик' : ''}.mp4`);
      downloaded = true;
      const a = await upload(
        new File([blob], animatic ? 'Аниматик.mp4' : 'Фильм.mp4', {
          type: 'video/mp4',
        }),
        report,
        controller.signal,
      );
      const target = animatic?undefined:p.items.find((i) => i.stage === 8);
      await action(
        animatic ? 'saveAnimaticPreview' : 'addVariant',
        {
          ...(basis?{basis}:{}),
          title: animatic
            ? 'Аниматик · ' + new Date().toLocaleTimeString('ru-RU')
            : 'Монтаж · ' + new Date().toLocaleTimeString('ru-RU'),
          text: animatic
            ? 'Аниматик из утверждённой раскадровки с выбранной озвучкой.\n' + editPlan(p,true).audio.map(v=>`${v.title}: ${[...MODELS,...SYNC_MODELS].find(m=>m.id===v.model)?.name??v.model} · ${v.voiceId||'загруженный голос'} · вариант ${v.id}`).join('\n') + '\nДлительности кадров при сборке:\n' + timing
            : 'Монтаж из утвержденных видеопланов. Исходный звук видеомоделей отключен; отдельные звуковые дорожки сведены по таймлайну. Длительности планов при сборке:\n' + timing,
          kind: 'video',
          assetId: a.id,
          duration: seconds,
          refs: [],
        },
        animatic?'':target?.id,
      );
    } catch (e) {
      if (downloaded) throw new Error('Готовый MP4 передан браузеру для скачивания. Сохранить карточку в студии не удалось: ' + (e as Error).message);
      throw e;
    } finally {
      if (renderAbort.current === controller) {
        report('');
        renderAbort.current = null;
      }
    }
  }
  const failures =
    p?.jobs.filter((j) => ['unknown', 'failed'].includes(j.status)&&!journalArchived(j)) ?? [];
  const active =
    p?.jobs.filter((j) =>
      ['queued', 'dispatching', 'pending', 'saving'].includes(j.status),
    ) ?? [];
  return (
    <SidebarProvider>
      <Sidebar className="studio-sidebar">
        <SidebarHeader>
          <div className="brand">
            <Film />
            <span>
              КАДР<span className="brand-dot">.</span>
            </span>
          </div>
          <div className="workspace-label">РЕЖИССЕРСКАЯ СТУДИЯ</div>
          <form action="/api/auth/logout" method="post"><Button type="submit" variant="ghost" size="sm">Выйти</Button></form>
          <Button
            variant="outline"
            className="project-button"
            onClick={() => setDialog('projects')}
          >
            <FolderOpen />
            <span>{p?.title || 'Выбрать фильм'}</span>
            <ChevronDown />
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <div className="nav-heading">ПРОИЗВОДСТВО</div>
            <SidebarMenu>
              {WORKFLOW.map(({title:label,id:i},index) => {
                const done = p && stageComplete(p,i);
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      isActive={i === step && panel === 'stage'}
                      onClick={() => {
                        setStep(i);
                        setPanel('stage');
                        setItemId('');
                        setDraft('');
                      }}
                    >
                      <span
                        className={'step-number ' + (done ? 'step-done' : '')}
                      >
                        {done ? (
                          <Check size={14} />
                        ) : (
                          String(index + 1).padStart(2, '0')
                        )}
                      </span>
                      {label}
                      {p && !workflowReady(p, i) && (
                        <Lock size={12} className="nav-lock" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <div className="nav-heading">МАТЕРИАЛЫ</div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={panel === 'library'}
                  onClick={() => setPanel('library')}
                >
                  <Library />
                  Библиотека фильмов
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Button
            variant="ghost"
            className="budget-mini"
            onClick={() => setPanel('budget')}
          >
            <Wallet size={17} />
            <span>
              Учтено расходов<strong>{money(balance.actual)}</strong>
            </span>
            {balance.unknown > 0 && <span className="warning-dot" />}
          </Button>
          <Button variant="ghost" onClick={() => setPanel('connections')}>
            <Settings2 />
            Подключения
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div className="row">
            <SidebarTrigger />
            <span className="muted">Проект</span>
            <span className="slash">/</span>
            <strong>{p?.title || 'Новый фильм'}</strong>
          </div>
          <div className="row">
            <span className="format-chip">
              Анимация · {p?.seconds ?? 50} сек · {p?.format ?? '16:9'}
            </span>
            {p && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Настройки фильма"
                onClick={() => setDialog('settings')}
              >
                <Settings2 size={17} />
              </Button>
            )}
          </div>
        </header>
        <main className="workspace">
          {(error || pq.error || projects.error) && (
            <div className="error-banner" role="alert">
              <span>
                {error || pq.error?.message || projects.error?.message}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Обновить данные"
                onClick={() => {
                  setError('');
                  qc.invalidateQueries();
                }}
              >
                <RefreshCw size={16} />
              </Button>
            </div>
          )}
          {renderStatus && (
            <div className="info-banner">
              <Loader2 className="spin" />
              <span>{renderStatus} Оставьте вкладку открытой.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => renderAbort.current?.abort()}
              >
                Отменить сборку
              </Button>
            </div>
          )}
          {panel === 'connections' ? (
            <Connections
              data={cq.data}
              refresh={() =>
                qc.invalidateQueries({ queryKey: ['connections'] })
              }
              perform={perform}
              busy={busy}
            />
          ) : panel === 'library' ? (
            <LibraryPanel
              projects={projects.data ?? []}
              current={p}
              assets={assets}
              action={action}
              perform={perform}
            />
          ) : !p ? (
            <section className="welcome">
              <div className="eyebrow">НОВЫЙ ФИЛЬМ</div>
              <h1>С чего начнется история?</h1>
              <p>
                Сценарий, персонажи и каждый план — с вашим выбором на каждом
                этапе.
              </p>
              <Button onClick={() => setDialog('projects')}>
                <Plus />
                Создать фильм
              </Button>
              {projects.isLoading && <Loader2 className="spin" />}
            </section>
          ) : panel === 'budget' ? (
            <Budget p={p} action={action} perform={perform} replace={replace} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    ЭТАП {String(WORKFLOW.findIndex(s=>s.id===step) + 1).padStart(2, '0')} / 10
                  </div>
                  <h1>{stageTitle(step)}</h1>
                  <p className="muted">
                    {step===9 ? 'Соберите кадры с выбранными голосами, проверьте ритм и утвердите аниматик.' : step===6 ? 'Сравните голоса на одной фразе, затем создайте и утвердите реплики планов.' : step === 8
                      ? 'Проверьте ритм, соберите фильм и утвердите финальную версию.'
                      : step === 7
                        ? 'Создайте ролик для каждого плана. Сравните варианты и утвердите по одному на план.'
                      : step === 1 ? 'Создайте отдельный образ каждого героя. Утверждённые описания и изображения будут использоваться в следующих этапах.'
                      : 'Сравните варианты и утвердите направление фильма.'}
                  </p>
                </div>
                {showCards&&<div className="row wrap">
                  {step===1&&<Button variant="outline" disabled={busy} onClick={()=>{setCharacterTarget(undefined);setDialog('character')}}><Plus/>Добавить героя</Button>}
                  <Button
                    variant="outline"
                    disabled={!ready || busy}
                    onClick={() => {
                      setEditing(undefined);
                      setDialog('variant');
                    }}
                  >
                    <Plus />
                    Добавить вариант
                  </Button>
                  {step !== 8 && (
                    <Button
                      disabled={!ready || busy}
                      onClick={() => setDialog('generate')}
                    >
                      <Sparkles />
                      Создать с ИИ
                    </Button>
                  )}
                </div>}
              </div>
              {step===6&&<>
                <Tabs value={voiceView} onValueChange={setVoiceView} className="mb-5"><TabsList><TabsTrigger value="casting">Подбор голосов</TabsTrigger><TabsTrigger value="plans">Озвучка планов</TabsTrigger></TabsList></Tabs>
                {voiceView==='casting'&&<VoiceComparisonPanel p={p} connections={cq.data} busy={busy} perform={perform} action={action} replace={replace} onContinue={()=>setVoiceView('plans')}/>}
                {voiceView==='plans'&&<div className="info-banner"><div><strong>{stageComplete(p,6)?'Все активные реплики утверждены':'Утверждено '+group.filter(i=>isApproved(p,i)&&i.selectedId===i.approvedId&&chosen(i)?.kind==='audio'&&chosen(i)?.assetId).length+' из '+group.length+' выбранных материалов озвучки'}</strong><p>Аниматик собирается и утверждается на отдельном этапе. Прежняя общая дорожка в режиме «По планам» не блокирует переход.</p></div><Button variant="outline" onClick={()=>{setStep(9);setItemId('');}}>Перейти к аниматику<ArrowRight/></Button></div>}
              </>}
              {!ready && (
                <section className="editor-surface p-5 mb-5" aria-label="Что мешает перейти к этапу">
                  <div className="row"><Lock size={18} /><strong>{step === 8 ? 'Что мешает собрать фильм' : 'Что мешает перейти к этапу'} · {blockers.length}</strong></div>
                  <p>Проверьте перечисленные карточки, начиная с самого раннего этапа. Выбор варианта и его утверждение — отдельные действия. Сохранённые материалы доступны для просмотра.</p>
                  <div className="space-y-4 mt-4">
                    {blockers.map((blocker, index) => <div key={blocker.itemId ?? `stage-${blocker.stage}-${index}`}>
                      <strong>{STAGES[blocker.stage]} · {blocker.title}</strong>
                      <p>{blocker.reason}</p>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                        setStep(blocker.stage); setItemId(blocker.itemId ?? '');
                      }}>Открыть {blocker.itemId ? 'карточку' : 'этап'}<ArrowRight size={14}/></Button>
                    </div>)}
                  </div>
                </section>
              )}
              {active.length > 0 && (
                <div className="info-banner">
                  <Loader2 className="spin" />
                  <span>
                    В серии осталось {active.length} попыток. Обработка
                    продолжается, пока студия открыта; при возвращении очередь
                    возобновится.
                    {step===5&&' Можно открыть другой план и запустить «Создать с ИИ», не дожидаясь текущего кадра.'}
                  </span>
                  <Button variant="ghost" onClick={() => setPanel('budget')}>
                    Посмотреть
                  </Button>
                </div>
              )}
              {failures.length > 0 && (
                <div className="small-notice">
                  {failures.length} попыток требуют внимания.{' '}
                  <Button variant="link" onClick={() => setPanel('budget')}>
                    Открыть журнал
                  </Button>
                </div>
              )}
              {showCards&&<div className="item-bar">
                <div className="item-tabs">
                  {group.map((i) => (
                    <Button
                      key={i.id}
                      variant={i.id === item?.id ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setItemId(i.id);
                        setDraft('');
                      }}
                    >
                      {isApproved(p, i) && <Check size={14} />} {i.title}
                      <span className="count">{i.variants.length}</span>
                    </Button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Добавить персонажа, план или материал"
                  onClick={() => {if(step===1){setCharacterTarget(undefined);setDialog('character')}else setDialog('item')}}
                >
                  <Plus />
                </Button>
              </div>}
              {step===1&&<section className="editor-surface p-5 mb-5" aria-label="Карточка героя">
                {item?.character ? <>
                  <div className="row spread"><strong>{item.character.name} · исходная карточка</strong><Button variant="outline" disabled={busy} onClick={()=>{setCharacterTarget(item.id);setDialog('character')}}>Описание и исходные фото</Button></div>
                  {item.character.appearance&&<p><strong>Неизменные черты:</strong> {item.character.appearance}</p>}
                  {item.character.description&&<p className="whitespace-pre-wrap">{item.character.description}</p>}
                  {item.character.instructions&&<p><strong>Задача для образа:</strong> {item.character.instructions}</p>}
                  <div className="reference-grid">{item.character.refs.map(ref=><div className="reference" key={ref}><img src={'/api/assets/'+ref} alt={`Исходный прообраз ${item.character!.name}`}/><span>Исходный прообраз</span></div>)}</div>
                  {item.approvedId&&JSON.stringify(item.character)!==JSON.stringify(item.variants.find(v=>v.id===item.approvedId)?.character)&&<p className="warning-text">Исходная карточка и утверждённый образ различаются. Следующие этапы используют описание и изображение утверждённого варианта.</p>}
                  <p className="muted">Создайте несколько образов через «Создать с ИИ», выберите лучший и утвердите его. Можно также использовать готовое изображение из карточки героя.</p>
                </> : <p>Добавьте отдельную карточку для каждого героя: имя, описание, исходное изображение по желанию и указания, что сохранить или изменить. Если общее описание «Персонажи» уже перенесено в отдельные карточки, эту общую карточку можно удалить.</p>}
                {item&&<Button variant="outline" disabled={busy} className="mt-3" onClick={()=>perform(async()=>{await action('removeCharacter',undefined,item.id);setItemId('');})}><Trash2/>Удалить карточку «{item.title}»</Button>}
              </section>}
              {step===1&&p.items.some(i=>i.stage===1&&i.removedAt)&&<details className="editor-surface p-4 mb-5"><summary>Удалённые карточки героев · {p.items.filter(i=>i.stage===1&&i.removedAt).length}</summary>
                <p className="muted small">Карточки исключены из основы фильма. Восстановите нужную, выберите образ и утвердите его.</p>
                {p.items.filter(i=>i.stage===1&&i.removedAt).map(i=><div className="row spread py-2" key={i.id}><span>{i.title} · вариантов: {i.variants.length}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>perform(async()=>{await action('restoreCharacter',undefined,i.id);setItemId(i.id);})}><Undo2/>Восстановить</Button></div>)}
              </details>}
              {step === 4 &&
                p.items.some((i) => i.stage === 4 && isApproved(p, i)) && (
                  <div className="info-banner">
                    <Clapperboard />
                    <span>
                      Подробный сценарий утвержден. Подготовьте отдельные
                      карточки раскадровки и видеопланов.
                    </span>
                    <Button
                      variant="outline"
                      disabled={
                        busy || active.length > 0
                      }
                      onClick={() =>
                        perform(async () => {
                          await action('prepareShots');
                          setStep(5);
                          setItemId('');
                        })
                      }
                    >
                      Подготовить планы
                    </Button>
                  </div>
                )}
              {step === 5 && (
                <div className="info-banner">
                  <div>
                    <strong>Раскадровка по планам сценария · {group.length} карточек</strong>
                    <p>{videoScript?.message || 'Откройте план и нажмите «Создать с ИИ». Для каждого плана создайте одно отдельное изображение, затем выберите и утвердите его.'}</p>
                    <p>Карточки обновляются по планам утверждённого сценария. Готовые изображения сохраняются; вид речи, говорящий и описания из сценария подтягиваются заново. Лишние карточки доступны в истории и не требуют утверждения.</p>
                  </div>
                  <Button variant="outline" disabled={busy || !videoScript?.variant || active.length > 0}
                    onClick={() => perform(() => action('prepareShots'))}>Подтянуть карточки из сценария</Button>
                  <Button className="h-auto whitespace-normal" disabled={busy || !ready || active.length > 0 || !storyboardBatchPlans(p).length}
                    onClick={() => setDialog('storyboard-batch')}><Sparkles />Создать кадры всех планов</Button>
                </div>
              )}
              {step === 7 && (
                <div className="info-banner">
                  <div>
                    <strong>Утверждено {group.filter(i => isApproved(p, i) && i.variants.find(v => v.id === i.approvedId)?.kind === 'video').length} из {group.length} видеопланов</strong>
                    <p>{videoScript?.message || `В сценарии ${videoScript?.shots.length} планов на ${p.seconds} секунд. Откройте карточку плана → «Создать с ИИ» → проверьте первый кадр → запустите серию. Затем выберите лучший вариант и утвердите его.`}</p>
                    <p>Если для плана нет отдельного утверждённого кадра раскадровки, выберите или загрузите подходящее изображение в окне генерации.</p>
                  </div>
                  <Button variant="outline" disabled={busy || !videoScript?.variant || active.length > 0}
                    onClick={() => perform(() => action('syncVideoPlans'))}>Подтянуть планы из сценария</Button>
                  <div className="w-full">
                    <Button variant="outline" className="h-auto whitespace-normal mb-3" disabled={busy || active.length > 0}
                      onClick={() => setDialog('lipsync')}><Mic />Синхронизировать губы · sync-3</Button>
                    <Button className="h-auto whitespace-normal" disabled={busy || !ready || active.length > 0 || !item || !selectedVideoModel(p, item) || !remainingVideoPlans(p).length}
                      onClick={() => setDialog('remaining-video')}>
                      <Sparkles />Создать оставшиеся планы выбранной моделью
                    </Button>
                    <p className="mt-2 muted">{!ready ? 'Сначала утвердите предыдущие этапы. Озвучка и раскадровка должны быть актуальными.'
                      : active.length > 0 ? 'Дождитесь завершения текущей серии генерации.'
                      : !remainingVideoPlans(p).length ? 'Нет планов для этой серии: у всех уже есть видео либо попытка с неизвестным исходом. Проверьте журнал попыток.'
                      : item && selectedVideoModel(p, item)
                      ? `Модель: ${selectedVideoModel(p, item)!.name}. Без видео: ${remainingVideoPlans(p).length}. Перед запуском — выбор первых кадров и оценка всей серии.`
                      : 'Сначала выберите готовый видеоролик в любой карточке: его модель будет использована для остальных планов.'}</p>
                    {item && selectedVideoModel(p, item) && chosen(item)?.deps !== dependencies(p, 7) && <p className="muted small">У выбранного ролика изменилась основа. Для новых планов используется только его модель; сценарий и первые кадры берутся из текущего проекта.</p>}
                  </div>
                </div>
              )}
              {currentShot && (
                <div className="editor-surface p-5 mb-5">
                  <strong>{currentShot.title} · {currentShot.duration} сек · из утверждённого сценария</strong>
                  <p className="whitespace-pre-wrap mt-3">{currentShot.description}</p>
                  <p className="mt-3">Камера: {currentShot.camera}</p>
                  <p className="mt-3">Монтаж: {currentShot.continuity}</p>
                  <p className="mt-3">{speechNames[speechInfo(currentShot).speechType]}{currentShot.speaker?' · '+currentShot.speaker:''}: {currentShot.dialogue || 'Без речи'}</p>
                </div>
              )}
              {[5,6,7].includes(step)&&p.items.some(i=>i.stage===step&&i.planArchive)&&<details className="editor-surface p-5 mb-5">
                <summary>История карточек · {p.items.filter(i=>i.stage===step&&i.planArchive).length}</summary>
                <p className="muted">Эти карточки заменены актуальными планами или отсутствуют в новом сценарии. Они не участвуют в утверждении и сборке. Файлы, варианты и расходы сохранены.</p>
                {p.items.filter(i=>i.stage===step&&i.planArchive).map(i=><details className="mt-4" key={i.id}><summary>{i.title} · {i.variants.length} вариантов</summary>
                  {i.planArchive?.replacementId&&<p>Актуальный план: {p.items.find(card=>card.id===i.planArchive!.replacementId)?.title}</p>}
                  {i.variants.map(v=><div className="editor-surface p-3 mt-3" key={v.id}><strong>{v.title}</strong>{v.assetId?<><Media v={v}/><a href={'/api/assets/'+v.assetId} target="_blank" rel="noreferrer">Открыть файл</a></>:<p className="whitespace-pre-wrap">{readableText(v.text)}</p>}</div>)}
                </details>)}
              </details>}
              {[5, 6, 7].includes(step) && showCards && <BulkApproval p={p} stage={step} busy={busy} action={action} perform={perform} />}
              {(step === 8 || step === 9) && (
                <Timeline
                  p={p}
                  animatic={step === 9}
                  busy={busy}
                  onRender={() => perform(() => assemble(step === 9))}
                  action={action}
                  perform={perform}
                />
              )}
              {step===9&&<AnimaticPanel p={p} busy={busy} perform={perform} action={action} onContinue={()=>{setStep(7);setItemId('');}}/>}
              {step === 6 && voiceView==='plans' && <div className="editor-surface p-5 mb-5">
                <strong>Озвучка по планам</strong>
                <p>Реплики из сценария, один выбранный голос. В аниматике кадр автоматически продлится до конца реплики, следующие кадры и голоса сдвинутся вместе. Общая длительность проверяется перед сборкой.</p>
                <Button disabled={busy || !ready || active.length > 0} onClick={() => setDialog('speech-batch')}><Mic />Подготовить озвучку по планам</Button>
                <Field label="Что звучит при сборке"><Drop label="Режим озвучки" value={p.speechMode ?? 'track'} options={[{value:'track',label:'Общая дорожка'},{value:'plans',label:'По планам'}]}
                  onChange={mode => perform(() => action('speechMode', {mode}))} /></Field>
                {p.speechMode!=='plans'&&p.items.some(i=>i.stage===6&&i.sourceShot&&!i.planArchive)&&<div className="note"><p>Есть отдельные реплики планов, но сейчас включена общая дорожка. Чтобы использовать и учитывать утверждения этих реплик, переключите режим.</p><Button variant="outline" disabled={busy} onClick={()=>perform(()=>action('speechMode',{mode:'plans'}))}>Использовать озвучку по планам</Button></div>}
                {item && !participates(p, item) && <p>Эта карточка сохранена в истории и не участвует в выбранном режиме озвучки.</p>}
              </div>}
              {item && showCards && (
                <Tabs defaultValue="variants">
                  <div className="section-toolbar">
                    <TabsList>
                      <TabsTrigger value="variants">
                        Варианты · {item.variants.length}
                      </TabsTrigger>
                      <TabsTrigger value="context">
                        Утвержденная основа
                      </TabsTrigger>
                    </TabsList>
                    <div className="row">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog('rename')}
                      >
                        Название материала
                      </Button>
                      <span
                        className={
                          'status-pill ' +
                          (isApproved(p, item) ? 'approved' : '')
                        }
                      >
                        {itemStatus(p, item)}
                      </span>
                    </div>
                  </div>
                  <TabsContent value="variants">
                    <div className="workbench">
                      <section className="variants-area">
                        {item.variants.length === 0 && step === 7 ? (
                          <div className="editor-surface p-5">Для этого плана пока нет роликов. Нажмите «Создать с ИИ»: описание, камера и длительность уже взяты из сценария.</div>
                        ) : item.variants.length === 0 ? (
                          <div className="editor-surface">
                            <div className="surface-heading">
                              <span>
                                {step === 0
                                  ? 'Исходный замысел'
                                  : 'Описание материала'}
                              </span>
                              <span className="status-pill">Черновик</span>
                            </div>
                            <Textarea
                              aria-label="Исходный текст"
                              className="script-editor"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              placeholder={
                                step === 0
                                  ? 'Вставьте сценарий. Кто ваши герои, что с ними происходит и что должен почувствовать зритель?'
                                  : 'Опишите персонажа, сцену или режиссерское решение. Можно добавить свой файл или создать варианты с ИИ.'
                              }
                            />
                            <footer className="editor-footer">
                              <label className="upload-label">
                                <Upload size={16} />
                                <span>Загрузить .txt / .md</span>
                                <input
                                  type="file"
                                  accept=".txt,.md"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f)
                                      perform(async () => {
                                        if (f.size > 200000)
                                          throw new Error(
                                            'Сценарий больше 200 КБ.',
                                          );
                                        setDraft(await f.text());
                                      });
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <Button
                                disabled={!ready || !draft.trim() || busy}
                                onClick={() =>
                                  perform(async () => {
                                    await action('addVariant', {
                                      title: 'Авторский вариант',
                                      text: draft,
                                      kind: 'text',
                                      refs: [],
                                    });
                                    setDraft('');
                                  })
                                }
                              >
                                Сохранить вариант
                                <ArrowRight />
                              </Button>
                            </footer>
                          </div>
                        ) : (
                          <div className="variant-grid">
                            {item.variants.map((v, index) => {
                              const approved =
                                isApproved(p, item) && item.approvedId === v.id;
                              const stale = !variantCurrent(p, item, v);
                              const job = p.jobs.find((j) => j.id === v.jobId);
                              return (
                                <article
                                  className={
                                    'variant-card ' +
                                    (v.id === item.selectedId ? 'selected' : '')
                                  }
                                  key={v.id}
                                >
                                  <div className="variant-card-head">
                                    <span className="eyebrow">
                                      ВАРИАНТ{' '}
                                      {String(index + 1).padStart(2, '0')}
                                    </span>
                                    {approved ? (
                                      <span className="approved-label">
                                        <Check size={14} />
                                        Утвержден
                                      </span>
                                    ) : stale ? (
                                      <span className="stale-label">
                                        Основа изменилась
                                      </span>
                                    ) : (
                                      <span className="muted">
                                        {v.id === item.selectedId
                                          ? 'Выбран'
                                          : 'На рассмотрении'}
                                      </span>
                                    )}
                                  </div>
                                  <Media v={v} />
                                  <div className="variant-body">
                                    <h2>{v.title}</h2>
                                    {v.character&&<details><summary>Описание этого образа · {v.character.name}</summary><p>{v.character.appearance}</p><p className="whitespace-pre-wrap">{v.character.description}</p><p className="whitespace-pre-wrap">{v.character.instructions}</p></details>}
                                    <div className="variant-meta">
                                      <span>
                                        {[...MODELS, ...SYNC_MODELS].find((m) => m.id === v.model)
                                          ?.name ?? v.model}
                                      </span>
                                      <span>
                                        {job
                                          ? job.actual !== null
                                            ? money(job.actual)
                                            : 'Стоимость уточняется'
                                          : 'Без генерации'}
                                      </span>
                                    </div>
                                    {v.text && (
                                      <p className="variant-text">
                                        {readableText(v.text)}
                                      </p>
                                    )}
                                    {v.kind !== 'text' && !v.character && (
                                      <div className="shot-meta">
                                        <span>
                                          <Clock size={14} />
                                          {v.duration} сек
                                        </span>
                                        {v.camera && <span>{v.camera}</span>}
                                        {v.dialogue && <p><strong>{speechNames[speechInfo(v).speechType]}{v.speaker?' · '+v.speaker:''}:</strong> «{v.dialogue}»</p>}
                                        {v.continuity && (
                                          <p>Монтаж: {v.continuity}</p>
                                        )}
                                      </div>
                                    )}
                                    <div className="card-actions">
                                      <Button
                                        variant={
                                          item.selectedId === v.id
                                            ? 'secondary'
                                            : 'outline'
                                        }
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                          perform(() =>
                                            action('select', {
                                              variantId: v.id,
                                            }),
                                          )
                                        }
                                      >
                                        {item.selectedId === v.id ? (
                                          <Check />
                                        ) : (
                                          <span />
                                        )}
                                        Выбрать
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setEditing(v);
                                          setDialog('variant');
                                        }}
                                      >
                                        <Copy />
                                        Правки
                                      </Button>
                                      {v.assetId && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          aria-label="Скачать материал"
                                          render={
                                            <a
                                              href={'/api/assets/' + v.assetId}
                                              download={v.title}
                                            />
                                          }
                                        >
                                          <Download size={15} />
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="sm" disabled={busy} aria-label={`Удалить вариант «${v.title}»`}
                                        onClick={()=>perform(()=>action('deleteVariant',{variantId:v.id},item.id))}><Trash2/>Удалить</Button>
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                        {!!p.removedVariants?.some(r=>r.itemId===item.id) && <details className="editor-surface p-4 mt-4">
                          <summary>Удалённые варианты · {p.removedVariants.filter(r=>r.itemId===item.id).length}</summary>
                          <p className="muted small">Можно восстановить вариант, затем выбрать и при необходимости утвердить его. Расходы на генерацию сохраняются.</p>
                          {p.removedVariants.filter(r=>r.itemId===item.id).map(r=><div key={r.variant.id} className="row spread py-2">
                            <span>{r.variant.title} · {r.variant.model}</span><Button size="sm" variant="outline" disabled={busy}
                              onClick={()=>perform(()=>action('restoreVariant',{variantId:r.variant.id}))}><Undo2/>Восстановить</Button>
                          </div>)}
                        </details>}
                      </section>
                      <aside className="notes-panel">
                        <div className="eyebrow">РЕЖИССЕРСКОЕ РЕШЕНИЕ</div>
                        <h2>
                          {selected
                            ? 'Этот вариант подходит?'
                            : 'Сначала — вариант'}
                        </h2>
                        <p>
                          {selected
                            ? selected.title
                            : 'Сохраните описание или создайте несколько вариантов, затем выберите лучший.'}
                        </p>
                        <div className="rule-line" />
                        <div className="checkline">
                          {item.variants.length ? (
                            <Check size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          Материал подготовлен
                        </div>
                        <div className="checkline">
                          {selected ? (
                            <Check size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          Вариант выбран
                        </div>
                        <div className="checkline">
                          {selectedApproved ? (
                            <Check size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          {selectedApproved ? 'Этот вариант утверждён' : isApproved(p, item) ? 'Утверждён другой вариант' : item.approvedId ? 'Утверждение требует пересмотра' : 'Вариант ещё не утверждён'}
                        </div>
                        {staleStoryboard ? <div className="note">
                          <p>Этот вариант раскадровки создан для прежней основы фильма. Сравните его с текущим планом: если он подходит, подтвердите его повторно.</p>
                          {storyboardReason&&<p role="status">{storyboardReason}</p>}
                          <Button className="approve-button h-auto whitespace-normal" disabled={busy||!!storyboardReason} onClick={()=>perform(()=>action('reapproveStoryboard',{variantId:selected!.id}))}><Check/>Утвердить раскадровку для текущей версии</Button>
                          <p className="muted small">Изображение и описание сохранятся в этой же карточке. Повторная генерация не запускается. Зависимые озвучку, аниматик и видеопланы проверяйте отдельно.</p>
                        </div> : staleScript ? <div className="note">
                          <p>Этот сценарий создан для прежней основы фильма. Проверьте его текст: если он по-прежнему подходит, утвердите его для текущей версии.</p>
                          {scriptReason&&<p role="status">{scriptReason}</p>}
                          <Button className="approve-button h-auto whitespace-normal" disabled={busy||!!scriptReason} onClick={()=>perform(()=>action('reapproveScript',{variantId:selected!.id}))}><Check/>Утвердить сценарий для текущей версии</Button>
                          <p className="muted small">Сохранится эта же карточка и её текст. Раскадровку и другие материалы, зависящие от изменённой основы, нужно проверить отдельно.</p>
                        </div> : staleSpeech ? <div className="note">
                          <p>После создания записи изменились сценарий или раскадровка. Прослушайте выбранную запись. Если она подходит этому плану, подтвердите её для текущей версии фильма.</p>
                          <p className="muted small">Записанные слова, голос и вид речи сохранятся. Если нужно изменить саму реплику, создайте новую озвучку.</p>
                          {speechReason&&<p role="status">{speechReason}</p>}
                          <Button className="approve-button h-auto whitespace-normal" disabled={busy||!!speechReason} onClick={()=>perform(()=>action('reapproveSpeech',{variantId:selected!.id}))}><Check/>Утвердить эту запись для текущей версии</Button>
                          <p className="muted small">Подтверждение обновляет эту же карточку. Дубль и платная генерация не создаются.</p>
                        </div> : staleStyle ? <div className="note">
                          <p>После создания стиля изменились сценарий или карточки героев. Если выбранный стиль по-прежнему подходит, подтвердите его для текущей версии. Текст и файл останутся в этой же карточке; дубль и платная генерация не создаются.</p>
                          {styleReason&&<p role="status">{styleReason}</p>}
                          <Button className="approve-button h-auto whitespace-normal" disabled={busy||!!styleReason} onClick={()=>perform(()=>action('reapproveStyle',{variantId:selected!.id}))}><Check/>Утвердить стиль для текущей версии</Button>
                        </div> : staleVideo ? <div className="note">
                          <p>После создания ролика изменились материалы предыдущих этапов. Если вы просмотрели видео и оно подходит, подтвердите его для текущей версии фильма. Статус обновится в этой же карточке без создания дубля. Генерация и оплата не запускаются.</p>
                          {reapprovalReason && <p role="status">{reapprovalReason}</p>}
                          <Button className="approve-button h-auto whitespace-normal" disabled={busy || !!reapprovalReason}
                            onClick={() => perform(() => action('reapproveVideo', {variantId: selected!.id}))}>
                            <Check/>Утвердить этот ролик для текущей версии
                          </Button>
                        </div> : <>
                        <Button
                          className="approve-button"
                          disabled={
                            !selected ||
                            !ready ||
                            busy ||
                            !variantCurrent(p, item, selected) ||
                            (step === 6 && selected.kind === 'video') ||
                            (isApproved(p, item) &&
                              item.approvedId === selected.id)
                          }
                          onClick={() => perform(() => action('approve'))}
                        >
                          <Check />
                          {selectedApproved ? 'Утверждено' : 'Утвердить вариант'}
                        </Button>
                        {!selectedApproved && (!ready || (selected && !variantCurrent(p, item, selected))) && <p className="note">
                          {!ready ? 'Сначала устраните причины блокировки предыдущих этапов в списке выше.' : 'Основа изменилась. Проверьте материал через «Правки», сохраните актуальную версию и утвердите её.'}
                        </p>}
                        </>}
                        {item.approvedId && (
                          <Button
                            variant="ghost"
                            className="full-width"
                            disabled={busy}
                            onClick={() => perform(() => action('unapprove'))}
                          >
                            Вернуть на доработку
                          </Button>
                        )}
                        <div className="note">
                          {step === 6 && selected?.kind === 'video' && <p>Аниматик — результат просмотра. Для сборки утвердите вариант с аудиозаписью.</p>}
                          Правки сохраняются новой версией. После изменения
                          утвержденной основы следующие этапы потребуют
                          пересмотра.
                        </div>
                        {step < 8 && (
                          <Button
                            variant="ghost"
                            className="full-width"
                            onClick={() => {
                              setStep(nextStage(step)??8);
                              setItemId('');
                            }}
                          >
                            Следующий этап
                            <ArrowRight size={16} />
                          </Button>
                        )}
                      </aside>
                    </div>
                  </TabsContent>
                  <TabsContent value="context">
                    <div className="context-list">
                      {p.items
                        .filter((i) => i.stage < step && isApproved(p, i))
                        .map((i) => {
                          const v = i.variants.find(
                            (v) => v.id === i.approvedId,
                          )!;
                          return (
                            <article className="context-card" key={i.id}>
                              <div className="eyebrow">{STAGES[i.stage]}</div>
                              <h2>{i.title}</h2>
                              <Media v={v} />
                              <p className="preserve">{readableText(v.text)}</p>
                            </article>
                          );
                        })}
                      {step === 0 && (
                        <p className="muted">
                          Это первый этап. Утвержденная основа появится после
                          выбора сценария.
                        </p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
              <div className="bottom-note">
                <Clapperboard size={17} />
                <span>
                  Отдельная озвучка · Синхронизация губ для выбранных планов · Все попытки
                  сохраняются
                </span>
              </div>
            </>
          )}
        </main>
      </SidebarInset>
      <Dialog
        open={dialog === 'projects'}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ваши фильмы</DialogTitle>
            <DialogDescription>
              Переключитесь на проект или начните новую историю.
            </DialogDescription>
          </DialogHeader>
          <div className="project-list">
            {projects.data?.map((x) => (
              <Button
                key={x.id}
                variant={x.id === projectId ? 'secondary' : 'ghost'}
                onClick={() => {
                  switchProject(x.id);
                }}
              >
                <Film />
                {x.title}
              </Button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get('title'));
              perform(async () => {
                const epoch = projectEpoch.current, opened = dialogEpoch.current;
                const n = await request('/api/projects', 'POST', { title });
                replace(n);
                if (epoch === projectEpoch.current && opened === dialogEpoch.current) switchProject(n.id);
              });
            }}
          >
            <Field label="Название фильма">
              <Input
                name="title"
                required
                maxLength={100}
                placeholder="Например, Последний фонарь"
              />
            </Field>
            <Button type="submit" className="full-width" disabled={busy}>
              <Plus />
              Создать фильм
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {p && item && dialog === 'variant' && (
        <VariantEditor key={`${p.id}:${item.id}`}
          open={dialog === 'variant'}
          close={closeDialog}
          p={p}
          item={item}
          value={editing}
          assets={assets}
          upload={upload}
          busy={busy}
          perform={perform}
          save={(data: any) => action('addVariant', data)}
        />
      )}
      {p && item && dialog === 'generate' && (
        <GenerateDialog key={`${p.id}:${item.id}`}
          referenceAction={(assetId:string,restore=false)=>action(restore?'restoreReference':'hideReference',{assetId})}
          open={dialog === 'generate'}
          close={closeDialog}
          p={p}
          item={item}
          assets={assets}
          connections={cq.data}
          upload={upload}
          busy={busy}
          perform={perform}
          submit={async (data: any) => {
            replace(
              await request(
                '/api/projects/' + p.id + '/generate',
                'POST',
                data,
              ),
            );
          }}
        />
      )}
      {p && (
        <SettingsDialog
          open={dialog === 'settings'}
          close={closeDialog}
          p={p}
          busy={busy}
          perform={perform}
          save={(data: any) => action('settings', data)}
        />
      )}
      {p && item && dialog === 'remaining-video' && (
        <RemainingVideoDialog p={p} item={item} assets={assets} upload={upload} busy={busy} perform={perform}
          close={closeDialog} submit={async (data: any) => replace(await request(`/api/projects/${p.id}/generate-remaining`, 'POST', data))} />
      )}
      {p && dialog === 'storyboard-batch' && (
        <StoryboardBatchDialog p={p} assets={assets} connections={cq.data} busy={busy} perform={perform}
          referenceAction={(assetId:string,restore=false)=>action(restore?'restoreReference':'hideReference',{assetId})}
          close={closeDialog} submit={async (data: any) => replace(await request(`/api/projects/${p.id}/generate-storyboard`, 'POST', data))} />
      )}
      {p && dialog === 'speech-batch' && <SpeechBatchDialog p={p} connections={cq.data} busy={busy} perform={perform}
        close={closeDialog} submit={async (data: any) => { replace(await request(`/api/projects/${p.id}/generate-speech`, 'POST', data)); setItemId(''); }} />}
      {p && dialog === 'lipsync' && <LipsyncDialog p={p} connections={cq.data} busy={busy} perform={perform} upload={upload}
        openStage={(stage:number,target?:string)=>{setDialog(null);setStep(stage);setItemId(target??'');setPanel('stage');}}
        close={closeDialog} submit={async (data: any) => replace(await request(`/api/projects/${p.id}/generate-lipsync`, 'POST', data))} />}
      {p&&dialog==='character'&&<CharacterEditor key={`${p.id}:${characterTarget??'new'}`} item={p.items.find(i=>i.id===characterTarget)} assets={assets} upload={upload} busy={busy} perform={perform}
        canGenerate={stageReady(p,1)} close={closeDialog} save={async(profile:CharacterBrief,imageId:string|undefined,generate:boolean)=>{
          const next=await action('saveCharacter',{profile,imageId},characterTarget??'');
          const saved=characterTarget?next.items.find(i=>i.id===characterTarget):next.items.find(i=>i.character&&!p.items.some(old=>old.id===i.id&&old.character));
          if(saved)setItemId(saved.id);setStep(1);setDialog(generate?'generate':null);
        }}/>}
      <Dialog
        open={dialog === 'item' || dialog === 'rename'}
        onOpenChange={(v) => !v && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'rename' ? 'Название материала' : 'Новый материал'}
            </DialogTitle>
            <DialogDescription>
              Отдельная карточка для персонажа, локации, реплики или плана.
            </DialogDescription>
          </DialogHeader>
          <form
            key={dialog + item?.id}
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get('title'));
              perform(async () => {
                const next = await action(
                  dialog === 'rename' ? 'renameItem' : 'addItem',
                  { stage: step, title },
                );
                if (dialog !== 'rename') setItemId(next.items.at(-1)!.id);
                setDialog(null);
              });
            }}
          >
            <Field label="Название">
              <Input
                name="title"
                required
                maxLength={100}
                defaultValue={dialog === 'rename' ? item?.title : ''}
                placeholder="План 02 · Улица на рассвете"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Сохранить
            </Button>
            {dialog === 'rename' &&
              item &&
              !item.variants.length &&
              group.length > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    perform(async () => {
                      await action('removeEmpty');
                      setDialog(null);
                    })
                  }
                >
                  Удалить пустую карточку
                </Button>
              )}
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function CharacterEditor({item,assets,upload,busy,perform,canGenerate,close,save}:any) {
  const [profile,setProfile]=useState<CharacterBrief>(()=>item?.character??{name:'',appearance:'',description:'',instructions:'',refs:[]});
  const set=(key:keyof CharacterBrief,value:string|string[])=>setProfile(c=>({...c,[key]:value}));
  const valid=!!profile.name.trim()&&!!(profile.description.trim()||profile.appearance.trim()||profile.refs.length);
  const submit=(generate=false,imageId?:string)=>perform(()=>save(profile,imageId,generate));
  return <Dialog open onOpenChange={v=>!v&&!busy&&close()}><DialogContent className="sm:max-w-3xl modal-scroll">
    <DialogHeader><DialogTitle>{item?'Карточка героя':'Новый герой'}</DialogTitle><DialogDescription>Начните с текста или изображения и объясните, что сохранить и изменить. После создания образов утвердите один вариант.</DialogDescription></DialogHeader>
    <Field label="Имя героя"><Input aria-label="Имя героя" value={profile.name} maxLength={100} onChange={e=>set('name',e.target.value)} placeholder="Катя"/></Field>
    <Field label="Неизменные черты" hint="Короткое описание внешности и одежды для каждого видеоплана, до 160 символов."><Input aria-label="Неизменные черты героя" value={profile.appearance} maxLength={160} onChange={e=>set('appearance',e.target.value)} placeholder="Рыжие косы, веснушки, зелёные глаза, белая рубашка и красный галстук"/></Field>
    <Field label="Описание и характер"><Textarea aria-label="Описание и характер героя" value={profile.description} maxLength={4000} onChange={e=>set('description',e.target.value)} placeholder="Возраст, роль в истории, внешность, привычки и характер…"/></Field>
    <Field label="Что сделать с образом"><Textarea aria-label="Что сделать с образом героя" value={profile.instructions} maxLength={4000} onChange={e=>set('instructions',e.target.value)} placeholder="Например: сохранить черты лица с фотографии, превратить в рисованного героя, заменить одежду на пионерскую форму…"/></Field>
    <Field label="Исходные изображения · необязательно" hint="PNG, JPEG или WebP до 10 МБ. Можно выбрать сразу до пяти фотографий одного героя или добавлять их по очереди.">
      <div className="reference-grid">{profile.refs.map((ref,n)=><div className="reference active" key={ref}>
        <img src={'/api/assets/'+ref} alt={`Прообраз героя ${n+1}`}/><span>{n+1}. Исходный прообраз</span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={()=>set('refs',profile.refs.filter(r=>r!==ref))}>Убрать из карточки</Button>
        <Button variant="outline" size="sm" disabled={busy||!valid||!canGenerate} onClick={()=>submit(false,ref)}>Это готовый образ</Button>
      </div>)}</div>
      <Input aria-label="Загрузить прообраз героя" type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy||profile.refs.length>=5} onChange={e=>{
        const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)perform(async()=>{
          if(profile.refs.length+files.length>5)throw new Error('В карточке героя можно сохранить до пяти фотографий. Уберите лишние или выберите меньше файлов.');
          if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>10*1024*1024))throw new Error('Каждое изображение героя должно быть PNG, JPEG или WebP до 10 МБ.');
          for(const file of files){const a=await upload(file);setProfile(c=>({...c,refs:[...new Set([...c.refs,a.id])]}));}
        });
      }}/>
      <details><summary>Выбрать изображение из библиотеки</summary><div className="reference-grid">{assets.filter((a:Asset)=>['image/png','image/jpeg','image/webp'].includes(a.mime)&&!profile.refs.includes(a.id)).map((a:Asset)=><button className="reference" key={a.id} disabled={busy||profile.refs.length>=5} onClick={()=>set('refs',[...profile.refs,a.id])}><img loading="lazy" src={'/api/assets/'+a.id} alt={a.name}/><span>{a.name}</span></button>)}</div></details>
    </Field>
    <p className="muted">Исходная карточка сохраняется отдельно. Следующие этапы используют описание и изображение утверждённого варианта. Утверждения героев, стиля и локаций сохраняются при правках сценария. Замена образа потребует проверки подробного сценария, раскадровки, озвучки и видео.</p>
    {!canGenerate&&<p>Карточку можно заполнить сейчас. Для генерации и утверждения образа сначала утвердите общий сценарий.</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>Закрыть</Button><Button variant="outline" disabled={busy||!valid} onClick={()=>submit()}>Сохранить карточку</Button><Button disabled={busy||!valid||!canGenerate} onClick={()=>submit(true)}><Sparkles/>Сохранить и создать образы с ИИ</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function CharacterReferences({p,mode='image'}:{p:Project;mode?:'image'|'video'|'sync'}) {
  const heroes=approvedCharacters(p);if(!heroes.length)return null;
  return <section className="note" aria-label="Постоянные герои"><strong>Утверждённые герои · {heroes.length}</strong>
    <div className="reference-grid">{heroes.map(c=><div className="reference active" key={c.itemId}><img loading="lazy" src={'/api/assets/'+c.assetId} alt={`Утверждённый образ ${c.profile.name}`}/><span><Check size={14}/> {c.profile.name}</span></div>)}</div>
    <p>{mode==='image'?'Эти изображения автоматически добавляются к запросу вместе с описаниями. Они задают внешность; состав сцены берётся из карточки плана.':mode==='video'?'Описания героев добавляются к каждому промпту. Grok также получает отдельные изображения героев. MiniMax сохраняет внешность через первый кадр раскадровки.':'Описания героев добавляются к задаче. sync-3 получает их внешность через утверждённый кадр раскадровки.'}</p>
  </section>;
}
function SpeechModeFields({value,onChange,disabled=false,allowNone=true,allowCharacter=true}:{value:SpeechInfo;onChange:(value:SpeechInfo)=>void;disabled?:boolean;allowNone?:boolean;allowCharacter?:boolean}) {
  return <div className="note space-y-3">
    <Field label="Вид речи"><Drop label="Вид речи" value={value.speechType} disabled={disabled}
      options={Object.entries(speechNames).filter(([id])=>(allowNone||id!=='none')&&(allowCharacter||id!=='character')).map(([id,label])=>({value:id,label}))}
      onChange={id=>onChange({...value,speechType:id as SpeechInfo['speechType']})}/></Field>
    {value.speechType!=='none'&&<Field label={value.speechType==='character'?'Кто говорит в кадре':'Кто читает за кадром · необязательно'}><Input aria-label="Имя говорящего" value={value.speaker} maxLength={100} disabled={disabled} onChange={e=>onChange({...value,speaker:e.target.value})} placeholder={value.speechType==='character'?'Имя одного героя':'Например, Катя — рассказчица'}/></Field>}
    <p className="muted small">{value.speechType==='character'?'Только указанный герой говорит в кадре. Для совпадения губ с готовой озвучкой используйте sync-3.':'Герои не шевелят губами; синхронизация рта отключена.'} Один план — один вид речи и один говорящий. Чередование рассказчика и героев разделите на планы.</p>
    {!allowCharacter&&<p>Это общая закадровая дорожка. Для реплик в кадре нажмите «Подготовить озвучку по планам».</p>}
  </div>;
}
function PlanSpeechNote({p,item}:{p:Project;item:Item}) {
  const info=planSpeech(p,item);
  return <div className="note"><strong>{speechNames[info.speechType]}{info.speaker?' · '+info.speaker:''}</strong><p>{speechDirection(info)}</p><p className="muted small">Вид речи берётся из утверждённой озвучки. Изменить его можно через «Правки» в разделе «Голоса», затем утвердить вариант.</p></div>;
}
function VariantEditor({
  open,
  close,
  p,
  item,
  value,
  assets,
  upload,
  busy,
  perform,
  save,
}: any) {
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (open)
      setData({
        character:value?.character??item.character,
        characterRefs:value?.characterRefs,
        title: value ? value.title + ' · правки' : 'Авторский вариант',
        text: (!value?.text || value.text === 'Предложи самостоятельный вариант для текущего материала.') && [5, 7].includes(item.stage)
          ? videoShot(p, item)?.description ?? value?.text ?? '' : value?.text ?? '',
        kind:
          value?.kind ??
          (item.character || [3, 5].includes(item.stage)
            ? 'image'
            : item.stage === 6
              ? 'audio'
              : item.stage >= 7
                ? 'video'
                : 'text'),
        assetId: value?.assetId,
        refs: value?.refs ?? [],
        trim: value?.trim ?? 0,
        offset: value?.offset ?? 0,
        volume: value?.volume ?? 1,
        ...planFields(p, item, value),
        voiceId: value?.voiceId ?? '',
      });
  }, [open, value, item.id]);
  function set(k: string, v: any) {
    setData((s: any) => ({ ...s, [k]: v }));
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-3xl modal-scroll">
        <DialogHeader>
          <DialogTitle>
            {value ? 'Правки → новый вариант' : 'Добавить вариант'}
          </DialogTitle>
          <DialogDescription>
            Старая версия сохранится. Для продолжения работы утвердите новую.
          </DialogDescription>
        </DialogHeader>
        {[5, 7].includes(item.stage) && videoShot(p, item) && (
          <div className="note">
            <p>План «{videoShot(p, item)!.title}». Пустые параметры старых генераций заполнены из утверждённого сценария. Проверьте их и сохраните новый вариант.</p>
            <Button variant="outline" onClick={() => {
              const shot = videoShot(p, item)!;
              setData((current: any) => ({ ...current, text: shot.description, duration: shot.duration,
                camera: shot.camera, continuity: shot.continuity, dialogue: shot.dialogue, ...speechInfo(shot), shotSource: scriptVideo(p).variant?.id }));
            }}>Подставить параметры из сценария</Button>
          </div>
        )}
        <div className="form-grid">
          <Field label="Название">
            <Input
              value={data.title ?? ''}
              onChange={(e) => set('title', e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Тип">
            <Drop
              label="Тип материала"
              value={data.kind ?? 'text'}
              onChange={(v) => set('kind', v)}
              options={Object.entries(kindNames).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Field>
        </div>
        {data.character&&<section className="space-y-3" aria-label="Описание варианта героя">
          <Field label="Имя героя в этом варианте"><Input value={data.character.name} maxLength={100} onChange={e=>set('character',{...data.character,name:e.target.value})}/></Field>
          <Field label="Неизменные черты этого образа"><Input value={data.character.appearance} maxLength={160} onChange={e=>set('character',{...data.character,appearance:e.target.value})}/></Field>
          <Field label="Описание и характер этого образа"><Textarea value={data.character.description} maxLength={4000} onChange={e=>set('character',{...data.character,description:e.target.value})}/></Field>
          <Field label="Указания для этого образа"><Textarea value={data.character.instructions} maxLength={4000} onChange={e=>set('character',{...data.character,instructions:e.target.value})}/></Field>
        </section>}
        <Field
          label={
            data.character ? 'Заметка к варианту' : data.kind === 'text'
              ? 'Сценарий / описание'
              : 'Описание происходящего'
          }
        >
          <Textarea
            className="edit-text"
            value={data.text ?? ''}
            onChange={(e) => set('text', e.target.value)}
          />
        </Field>
        {(data.kind !== 'text' || [5,7].includes(item.stage)) && (
          <>
            <Field label="Файл">
              <Drop
                label="Выбрать файл"
                value={data.assetId ?? ''}
                onChange={(v) => set('assetId', v)}
                options={assets
                  .filter((a: Asset) => a.mime.startsWith(data.kind + '/'))
                  .map((a: Asset) => ({ value: a.id, label: a.name }))}
              />
              <Input
                type="file"
                accept={data.kind + '/*'}
                disabled={loading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    perform(async () => {
                      setLoading(true);
                      try {
                        const a = await upload(f);
                        set('assetId', a.id);
                      } finally {
                        setLoading(false);
                      }
                    });
                  e.target.value = '';
                }}
              />
              {data.assetId && <Media v={data} />}
            </Field>
            <div className="form-grid">
              <Field label="В фильме, секунд">
                <Input
                  type="number"
                  min="0.2"
                  step="0.1"
                  value={data.duration ?? 5}
                  onChange={(e) => set('duration', Number(e.target.value))}
                />
              </Field>
              <Field label="Начало в исходном файле, сек">
                <Input
                  type="number"
                  min="0"
                  max="600"
                  step="0.1"
                  value={data.trim ?? 0}
                  onChange={(e) => set('trim', Number(e.target.value))}
                />
              </Field>
            </div>
            {data.kind === 'audio' ? (
              <div className="form-grid">
                <Field label="Начало в фильме, сек">
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={data.offset ?? 0}
                    onChange={(e) => set('offset', Number(e.target.value))}
                  />
                </Field>
                <Field label="Громкость (0–2)">
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={data.volume ?? 1}
                    onChange={(e) => set('volume', Number(e.target.value))}
                  />
                </Field>
              </div>
            ) : (
              <>
                <Field label="Крупность и движение камеры">
                  <Input
                    value={data.camera ?? ''}
                    onChange={(e) => set('camera', e.target.value)}
                    placeholder="Средний план; медленный наезд / [Push in]"
                  />
                </Field>
                <Field label="Стыковка с соседними планами">
                  <Textarea
                    value={data.continuity ?? ''}
                    onChange={(e) => set('continuity', e.target.value)}
                    placeholder="Начало и конец действия, направление взгляда, движение в следующем плане…"
                  />
                </Field>
              </>
            )}
            {[5,6].includes(item.stage)&&<SpeechModeFields value={speechInfo(data)} allowNone={data.kind!=='audio'} allowCharacter={data.kind!=='audio'||!!item.sourceShot} onChange={info=>setData((current:any)=>({...current,...info}))}/>}
            {item.stage===7&&<PlanSpeechNote p={p} item={item}/>}
            <Field label={speechInfo(data).speechType==='character'?'Реплика героя в кадре':'Закадровый текст'}>
              <Textarea
                value={data.dialogue ?? ''}
                onChange={(e) => set('dialogue', e.target.value)}
              />
            </Field>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Закрыть
          </Button>
          <Button
            disabled={busy || loading || !stageReady(p, item.stage)}
            onClick={() =>
              perform(async () => {
                await save(data);
                close();
              })
            }
          >
            Сохранить новую версию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function GenerateDialog({
  referenceAction,
  open,
  close,
  p,
  item,
  assets,
  connections,
  upload,
  busy,
  perform,
  submit,
}: any) {
  const [kind, setKind] = useState<Kind>('text');
  const [models, setModels] = useState<string[]>([]);
  const [modelSearch,setModelSearch]=useState('');
  const [count, setCount] = useState(3);
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [speech, setSpeech] = useState('');
  const [speechSource, setSpeechSource] = useState('current');
  const [speechMeta,setSpeechMeta]=useState<SpeechInfo>({speechType:'voiceover',speaker:''});
  const [voice, setVoice] = useState('');
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState('');
  const queueIssue=item.stage===5&&kind==='image'?storyboardAdmissionIssue(p,item.id):'';
  const allScriptAudio = scriptSpeech(p);
  const scriptAudio = {...allScriptAudio,sources:item.sourceShot?allScriptAudio.sources:allScriptAudio.sources.filter(s=>s.speechType==='voiceover')};
  const characters = speechCharacters(p);
  const spoken = spokenText(speech, [...characters,speechMeta.speaker]);
  const selectedSpeech = scriptAudio.sources.find((s) => s.id === speechSource);
  const shot = videoShot(p, item);
  useEffect(() => {
    if (open) {
      const v = chosen(item);
      const k: Kind = item.character || [3, 5].includes(item.stage)
        ? 'image'
        : item.stage === 6
          ? 'audio'
          : item.stage === 7
            ? 'video'
            : 'text';
      setKind(k);
      setModelSearch('');
      const preferred=k==='audio'&&MODELS.some(m=>m.id===p.preferredVoice?.model&&connections?.providers?.some((c:any)=>c.id===m.provider&&c.configured))?p.preferredVoice:undefined;
      setModels(preferred?[preferred.model]:[]);
      setCount(k === 'audio'?1:k === 'video' ? 2 : 3);
      setPrompt(
        k === 'text'
          ? item.stage === 0
            ? v
              ? `Доработай выбранный сценарий для анимационного фильма на ${p.seconds} секунд. Сохрани героев и основную идею. Усиль завязку, конфликт и финал, сделай диалоги естественными. Верни один цельный вариант сценария.`
              : `Предложи сценарий анимационного фильма на ${p.seconds} секунд с ясной завязкой, конфликтом и финалом.`
            : 'Предложи доработанный вариант текущего материала с учетом утвержденной основы. Сохрани ключевые решения и учти мои правки.'
          : item.character ? 'Создай один вариант образа героя по сохранённой карточке. Учти исходные изображения и указания режиссёра.'
          : k === 'video' ? videoPrompt(p, item) : k === 'image' && item.stage === 5 && videoShot(p, item)
            ? storyboardPrompt(p, item) : v?.text ?? 'Предложи самостоятельный вариант для текущего материала.',
      );
      const imageDefaults = item.character ? [] : v?.refs?.length ? v.refs
        : approvedCharacters(p).length ? [] : p.items
          .filter((i: Item) => i.stage === 3 && isApproved(p, i))
          .flatMap((i: Item) => i.variants
            .filter(x => x.id === i.approvedId && x.kind === 'image' && x.assetId)
            .map(x => x.assetId!)).slice(0, 5);
      setRefs(k === 'image'
        ? selectedReferences(p, characterImageRefs(p, item, imageDefaults))
        : k === 'video'
          ? (videoFrame(p, item) ? [videoFrame(p, item)!] : v?.refs?.slice(0, 1) ?? [])
          : v?.refs ?? []);
      const initial = initialSpeech(item, scriptAudio.sources, characters);
      setSpeech(k === 'audio' ? initial.dialogue : v?.dialogue ?? '');
      setSpeechMeta(speechInfo({...initial,speechType:initial.speechType==='none'?'voiceover':initial.speechType}));
      setSpeechSource(k === 'audio' ? initial.sourceId : 'current');
      setVoice(preferred?.voiceId ?? v?.voiceId ?? '');
      setEstimates({});
      setBatch(crypto.randomUUID());
    }
  }, [open, p.id, item.id]);
  const source = chosen(item);
  const choices = MODELS.filter((m) => m.kind === kind);
  const selected = choices.filter((m) => models.includes(m.id));
  const selectableRefs=kind==='image';
  const excludedRefs=hiddenReferences(p);
  const effectiveRefs=selectableRefs?selectedReferences(p,refs):refs;
  const effectivePrompt=kind==='video'?videoGenerationPrompt(p,item,prompt):prompt;
  const imageRequest=kind==='image'&&item.stage===5?storyboardImageRequest(p,item,prompt,effectiveRefs,1,count):undefined;
  const miniRequest=kind==='image'&&selected.some(m=>isMiniMaxImage(m.id))?miniMaxImageRequest(p,item,prompt,effectiveRefs,1,count):undefined;
  const falRequest=kind==='image'&&selected.some(m=>isFalImage(m.id))?compactImageRequest(p,item,prompt,effectiveRefs,1,count,FAL_PROMPT_BUDGET):undefined;
  const zenRequest=kind==='image'&&selected.some(m=>isZenCreatorImage(m.id))?compactImageRequest(p,item,prompt,effectiveRefs,1,count,ZEN_IMAGE_PROMPT_LIMIT):undefined;
  const imagePromptError=falRequest&&falRequest.length>FAL_PROMPT_BUDGET?'Qwen Image Edit: сократите задачу и описания до бюджета студии — 5000 символов.':zenRequest&&zenRequest.length>ZEN_IMAGE_PROMPT_LIMIT?'ZenCreator: сократите задачу, имена и описания до общего лимита 5000 символов.':miniRequest&&miniRequest.length>1500?'MiniMax image-01: сократите имена героев и описания до 1500 символов.':imageRequest?selected.filter(m=>!isMiniMaxImage(m.id)&&!isZenCreatorImage(m.id)&&!isFalImage(m.id)).map(m=>storyboardImagePromptIssue(imageRequest,m.id,item.title)).find(Boolean):'';
  const miniRefError=falRequest&&falRefIssue(effectiveRefs.map(id=>(assets as Asset[]).find(a=>a.id===id)).filter((a):a is Asset=>!!a))|| (miniRequest?miniMaxImageRefIssue(effectiveRefs.map(id=>(assets as Asset[]).find(a=>a.id===id)).filter((a):a is Asset=>!!a)):'');
  const speechIssue=kind==='audio'&&speechMeta.speechType==='character'&&!speechMeta.speaker.trim()?'Укажите имя говорящего героя.':'';
  const referenceError=selected.some(m=>kind==='image'&&effectiveRefs.length>(m.provider==='xai'?5:8))
    ? `С учётом героев выбрано ${effectiveRefs.length} изображений. В студии Grok принимает до 5, FLUX и GPT Image — до 8. Уберите дополнительные референсы или смените модель.`
    : selected.some(m=>kind==='video'&&m.provider==='xai'&&videoCharacterRefs(p,'xai').length>7)?'Grok Video принимает до 7 отдельных образов героев.':'';
  const computed = (m: (typeof MODELS)[number]) =>
    estimates[m.id] !== undefined
      ? estimates[m.id]
        ? ticks(estimates[m.id])
        : null
      : m.id === 'grok-imagine-image-2.0'
        ? (400000000n + BigInt(effectiveRefs.length) * 100000000n).toString()
        : m.id==='grok-imagine-video-1.5' ? (8500000000n+BigInt(videoCharacterRefs(p,'xai').length)*100000000n).toString()
        : m.estimate;
  let total: string | null = null;
  try {
    const costs = selected.map(computed);
    if (costs.length && costs.every((c) => c !== null))
      total = (
        costs.reduce((s, c) => s + BigInt(c!), 0n) * BigInt(count)
      ).toString();
  } catch {}
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-3xl modal-scroll">
        <DialogHeader>
          <DialogTitle>Серия вариантов</DialogTitle>
          <DialogDescription>
            {kind === 'video'
              ? 'Модель получит выбранный первый кадр и видеопромпт ниже. Проверьте внешность, стиль и действие. Выбирайте доступные модели одного типа; число вариантов задаётся для каждой.'
              : kind==='image'&&item.stage===5 ? 'Модель получит текущий план, утверждённые образы героев и визуальный стиль. Полный промпт можно проверить ниже. Выбирайте доступные модели одного типа; число вариантов задаётся для каждой.'
              : 'Утвержденные сценарий, характеры и стиль автоматически войдут в запрос. Выбирайте доступные модели одного типа; число вариантов задается для каждой.'}
          </DialogDescription>
        </DialogHeader>
        <div className="form-grid">
          <Field label="Что создаем">
            <Drop
              label="Тип генерации"
              value={kind}
              onChange={(v) => {
                setKind(v as Kind);
                setModels([]);
                if (v === 'audio') {
                  const initial = initialSpeech(item, scriptAudio.sources, characters);
                  setSpeech(initial.dialogue);
                  setSpeechMeta(speechInfo({...initial,speechType:initial.speechType==='none'?'voiceover':initial.speechType}));
                  setSpeechSource(initial.sourceId);
                }
              }}
              options={Object.entries(kindNames).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Field>
          <Field label="Вариантов от каждой модели">
            <Input
              type="number"
              min="1"
              max="4"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Найти модель" hint="Выберите любое число доступных моделей одного типа для сравнения. Выбранные модели остаются видны при поиске.">
          <Input aria-label="Найти модель" placeholder="ZenCreator, Seedance, Qwen…" value={modelSearch} onChange={e=>setModelSearch(e.target.value)}/>
        </Field>
        <div className="model-options">
          {choices.filter(m=>models.includes(m.id)||m.name.toLowerCase().includes(modelSearch.trim().toLowerCase())).map((m) => {
            const configured = connections?.providers?.find(
              (x: any) => x.id === m.provider,
            )?.configured;
            return (
              <div
                className={
                  'model-option ' + (models.includes(m.id) ? 'active' : '')
                }
                key={m.id}
              >
                <label className="row">
                  <Checkbox
                    checked={models.includes(m.id)}
                    disabled={!configured}
                    onCheckedChange={(v) => {
                      if (kind === 'audio') {
                        setModels(v ? [m.id] : []);
                        setVoice(p.preferredVoice?.model===m.id?p.preferredVoice.voiceId:source?.model===m.id?source.voiceId:'');
                      } else setModels(
                        v
                          ? [...models, m.id]
                          : models.filter((x) => x !== m.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {configured ? m.note : 'Добавьте API-ключ в Подключениях'}
                    </small>
                  </span>
                </label>
                {models.includes(m.id) && <ZenCost modelId={m.id} refs={effectiveRefs.length} count={count}/>}
                {models.includes(m.id) && (
                  <Field
                    label="Оценка одной попытки, USD"
                    hint="Неизвестную стоимость можно оставить пустой, если у проекта нет лимита."
                  >
                    <Input
                      inputMode="decimal"
                      placeholder={
                        m.estimate
                          ? String(Number(m.estimate) / 1e10)
                          : 'Неизвестно'
                      }
                      value={
                        estimates[m.id] ??
                        (m.id === 'grok-imagine-image-2.0'
                          ? String(0.04 + 0.01 * effectiveRefs.length)
                          : m.id==='grok-imagine-video-1.5' ? (0.85+0.01*videoCharacterRefs(p,'xai').length).toFixed(2)
                          : m.estimate
                            ? String(Number(m.estimate) / 1e10)
                            : '')
                      }
                      onChange={(e) =>
                        setEstimates({ ...estimates, [m.id]: e.target.value })
                      }
                    />
                  </Field>
                )}
              </div>
            );
          })}
        </div>
        {kind === 'text' && source?.text && (
          <Field
            label={item.stage === 0 ? 'Сценарий для доработки' : 'Материал для доработки'}
            hint={`Вариант «${source.title}» передается модели автоматически. Для изменения исходного текста используйте «Правки» на его карточке.`}
          >
            <Textarea
              aria-label={item.stage === 0 ? 'Сценарий для доработки' : 'Материал для доработки'}
              className="h-40 min-h-24 resize-y"
              value={source.text}
              readOnly
            />
          </Field>
        )}
        <Field
          label={
            kind === 'audio'
              ? 'Режиссерская задача (сохраняется в истории)'
              : kind === 'video' ? 'Действие, камера и монтаж' : 'Задача и правки для моделей'
          }
          hint={kind === 'text' ? 'Напишите, что улучшить или изменить. Исходный текст сюда копировать не нужно.' : kind === 'video' ? `${prompt.trim().length} / ${VIDEO_PROMPT_LIMIT} символов. Действие, камера и монтаж взяты из сценария. Можно исправить перед отправкой.` : undefined}
        >
          <Textarea
            aria-label={kind === 'video' ? 'Видеопромпт' : 'Задача и правки для моделей'}
            className="edit-text short"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>
        {kind === 'audio' ? (
          <>
            {scriptAudio.sources.length > 0 ? (
              <Field label="Реплики из сценария" hint="Текст и вид речи подставляются автоматически. Реплики героев озвучиваются по отдельным планам.">
                <Drop
                  label="Реплики из сценария"
                  value={speechSource}
                  options={[
                    ...(source?.dialogue.trim() ? [{ value: 'current', label: 'Текст текущего варианта' }] : []),
                    ...scriptAudio.sources.map((s) => ({ value: s.id, label: s.id === 'script:all' ? s.title : `${s.title} · ${speechNames[s.speechType]}${s.speaker?' · '+s.speaker:''} · с ${s.offset} сек` })),
                  ]}
                  onChange={(value) => {
                    setSpeechSource(value);
                    setSpeechMeta(speechInfo(value==='current'?source:scriptAudio.sources.find(s=>s.id===value)));
                    setSpeech(value === 'current' ? spokenText(source?.dialogue ?? '', characters) : scriptAudio.sources.find((s) => s.id === value)?.dialogue ?? '');
                  }}
                />
              </Field>
            ) : <p className="note">{scriptAudio.message}</p>}
            {selectedSpeech && (
              <p className="muted">
                {selectedSpeech.id === 'script:all'
                  ? 'Все реплики будут прочитаны подряд одним голосом, без пауз между планами. Для разных голосов создайте отдельные материалы и выберите в каждом нужный план.'
                  : `Реплика начнётся на ${selectedSpeech.offset} секунде фильма. Для неё отведено ${selectedSpeech.duration} сек; после прослушивания длительность можно поправить.`}
              </p>
            )}
            {selectedSpeech && selectedSpeech.originalDialogue !== selectedSpeech.dialogue && (
              <details className="muted">
                <summary>Исходная реплика с пометками</summary>
                <p className="whitespace-pre-wrap">{selectedSpeech.originalDialogue}</p>
              </details>
            )}
            <SpeechModeFields value={speechMeta} allowNone={false} allowCharacter={!!item.sourceShot} onChange={setSpeechMeta}/>
            {speechIssue&&<p role="alert">{speechIssue}</p>}
            <Field label={speechMeta.speechType==='character'?'Реплика героя в кадре':'Закадровый текст'} hint="Только произносимые слова. Имя и вид речи сохраняются отдельно и не озвучиваются.">
              <Textarea
                aria-label="Только произносимый текст"
                value={speech}
                onChange={(e) => setSpeech(e.target.value)}
                placeholder="Текст реплики, без технического описания сцены"
              />
            </Field>
            {speech !== spoken && (
              <Field label="На озвучку будет отправлено">
                <Textarea aria-label="На озвучку будет отправлено" value={spoken} readOnly />
              </Field>
            )}
            {speech.trim() && !spoken && <p role="alert">Здесь остались только служебные пометки. Выберите план с репликой.</p>}
            {selectedSpeech && speech !== selectedSpeech.dialogue && (
              <Button variant="outline" onClick={() => setSpeech(selectedSpeech.dialogue)}>
                Вернуть текст из сценария
              </Button>
            )}
            {speech.length > 9500 && <p role="alert">Текст длиннее 9500 символов. Выберите отдельный план для озвучки.</p>}
            <VoiceSelector provider={selected.length === 1 ? selected[0].provider : undefined} value={voice} onChange={setVoice} />
            <p className="muted">
              Для сравнения голосов разных провайдеров запускайте отдельные
              серии: у каждого свой Voice ID.
            </p>
          </>
        ) : (
          kind !== 'text' && (
            <Field
              label={
                kind === 'video'
                  ? 'Первый кадр (выберите одно изображение)'
                  : 'Визуальные референсы'
              }
            >
              <div className="reference-grid">
                {assets
                  .filter((a: Asset) => a.mime.startsWith('image/')&&(!selectableRefs||!excludedRefs.has(a.id)))
                  .map((a: Asset) => (
                    <div
                      className={
                        'reference ' + (effectiveRefs.includes(a.id) ? 'active' : '')
                      }
                      key={a.id}
                    >
                      <label><img src={'/api/assets/' + a.id} alt={a.name} />
                      <Checkbox
                        checked={effectiveRefs.includes(a.id)}
                        onCheckedChange={(v) =>
                          setRefs(
                            v
                              ? kind === 'video'
                                ? [a.id]
                                : [...refs, a.id]
                              : refs.filter((x) => x !== a.id),
                          )
                        }
                      />
                      <span>{a.name}</span></label>
                      {selectableRefs&&<Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Убрать из референсов: ${a.name}`} onClick={()=>perform(async()=>{await referenceAction(a.id);setRefs(current=>current.filter(id=>id!==a.id));})}><Trash2 size={14}/>Убрать из списка</Button>}
                    </div>
                  ))}
              </div>
              {selectableRefs&&<><p className="muted small">В запрос уйдут только отмеченные изображения. Можно снять любую галочку, включая образы героев. «Убрать из списка» скрывает изображение из референсов проекта; готовые варианты сохраняются.</p>
                {!!p.hiddenReferenceIds?.length&&<details><summary>Убранные референсы</summary>{assets.filter((a:Asset)=>p.hiddenReferenceIds.includes(a.id)).map((a:Asset)=><div className="row" key={a.id}><span>{a.name}</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>perform(()=>referenceAction(a.id,true))}>Вернуть в список</Button></div>)}</details>}</>}
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    perform(async () => {
                      const a = await upload(f);
                      setRefs(kind === 'video' ? [a.id] : [...refs, a.id]);
                    });
                  e.target.value = '';
                }}
              />
            </Field>
          )
        )}
        {item.stage>1&&['image','video'].includes(kind)&&!selectableRefs&&<CharacterReferences p={p} mode={kind==='video'?'video':'image'}/>}
        {referenceError&&<p role="alert">{referenceError}</p>}
        {falRequest&&<div className="note"><p>Qwen Image Edit: нужен хотя бы один референс. Полный промпт {falRequest.length} / 5000 символов — бюджет студии. {falRequest.shortened?'Длинные описания сокращены; проверьте промпт.':''} Оригинальные карточки сохраняются целиком.</p><details><summary>Промпт для fal.ai</summary><p className="whitespace-pre-wrap">{falRequest.prompt}</p></details></div>}
        {zenRequest&&<div className="note"><p>ZenCreator: полный промпт {zenRequest.length} / 5000 символов. {zenRequest.shortened?'Длинные части сокращены; проверьте описание перед запуском. ':''}Исходные карточки сохраняются целиком. Для героя передаются его описание, задача и утверждённый стиль; для кадра — текущий план и образы героев.</p>
          <details><summary>Промпт для ZenCreator{count>1?' · первый вариант':''}</summary><p className="whitespace-pre-wrap">{zenRequest.prompt}</p></details>
          {imagePromptError&&<p role="alert">{imagePromptError}</p>}
        </div>}
        {miniRequest&&<div className="note"><p>MiniMax image-01: {miniRequest.length} / 1500 символов. Длинные описания сокращаются; проверьте действие, стиль и внешность перед запуском. Исходные карточки сохраняются полностью.</p><details><summary>Промпт для MiniMax image-01</summary><p className="whitespace-pre-wrap">{miniRequest.prompt}</p></details>{miniRefError&&<p role="alert">{miniRefError}</p>}{imagePromptError&&<p role="alert">{imagePromptError}</p>}</div>}
        {imageRequest&&selected.some(m=>!isMiniMaxImage(m.id)&&!isZenCreatorImage(m.id)&&!isFalImage(m.id))&&<div className="note">
          <p>Полный промпт кадра: {imageRequest.length}{selected.some(m=>isOpenAIImage(m.id))?' / 32000':''} символов. Учтены стиль, герои, референсы и правило речи.</p>
          <details><summary>Промпт для модели{count>1?' · первый вариант':''}</summary><p className="whitespace-pre-wrap">{imageRequest.prompt}</p></details>
          {imagePromptError&&<p role="alert">{imagePromptError}</p>}
        </div>}
        {kind === 'video' && (
          <div className="note">
            {selected.some(m=>m.id==='MiniMax-H3')&&<p>MiniMax H3 использует выбранный первый кадр; пропорции видео определяются этим изображением. Сохранённый ключ MiniMax должен иметь доступ Pay-as-you-go. Образы героев учитываются в первом кадре и тексте, отдельные изображения героев не добавляются к этому запросу.</p>}
            <p>{selected.length ? selected.map(m=>`${m.name}: ${generationSeconds(m.id)} сек`).join(' · ') : 'Выберите модель, чтобы увидеть длительность'}.  В монтаж войдут первые {shot?.duration ?? 6} сек по сценарию. Проверьте, что действие успевает завершиться. Точность камеры зависит от модели.</p>
            {refs.length !== 1 && <p role="alert">Выберите или загрузите один первый кадр именно для этого плана. Общая раскадровка не подставляется во все сцены автоматически.</p>}
            <PlanSpeechNote p={p} item={item}/>
            <p>Промпт с героями и правилом речи: {effectivePrompt.trim().length} / {VIDEO_PROMPT_LIMIT} символов.</p>
            <details><summary>Полный промпт для модели</summary><p className="whitespace-pre-wrap">{effectivePrompt}</p></details>
            {effectivePrompt.trim().length > VIDEO_PROMPT_LIMIT && <p role="alert">Сократите задачу: общий видеопромпт с героями должен быть до {VIDEO_PROMPT_LIMIT} символов. Запрос пока не запускается.</p>}
            {shot && shot.duration > 6 && <p role="alert">План длиннее 6 секунд. Разделите его в подробном сценарии перед генерацией.</p>}
            {!shot && <p role="alert">Для этой карточки не найден план в утверждённом сценарии. Подтяните планы и выберите нужную карточку.</p>}
          </div>
        )}
        <div className="generation-total">
          <div>
            <span>Будет отправлено</span>
            <strong>{models.length * count} попыток</strong>
          </div>
          <div>
            <span>Предварительная оценка</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
        {queueIssue&&<p role="status">{queueIssue}</p>}
        <p className="muted small">
          {item.stage===5&&kind==='image'?'Изображения раскадровки обрабатываются параллельно. Пока идёт генерация, можно запустить другой план.':'Запросы выбранных моделей выполняются по очереди.'} Оценка не равна списанию. Неудачные и невыбранные попытки также
          попадут в журнал расходов.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Закрыть
          </Button>
          <Button
            disabled={
              busy ||
              !models.length || !!queueIssue ||
              !prompt.trim() ||
              prompt.trim().length>20000 || !!imagePromptError ||
              count < 1 ||
              count > 4 ||
              !!referenceError || !!miniRefError || !!speechIssue || (kind === 'video' && (refs.length !== 1 || effectivePrompt.trim().length > VIDEO_PROMPT_LIMIT || !shot || shot.duration > 6)) ||
              (kind === 'audio' && (!voice.trim() || !spoken || speech.length > 9500 || models.length > 1))
            }
            onClick={() =>
              perform(async () => {
                const es = Object.fromEntries(
                  selected.map((m) => [m.id, computed(m)]),
                );
                await submit({
                  revision: p.revision,
                  batchId: batch,
                  itemId: item.id,
                  models,
                  count,
                  prompt,
                  refs:effectiveRefs,
                  ...(selectableRefs?{referenceMode:'selected'}:{}),
                  dialogue: kind === 'audio' ? spoken : speech,
                  ...(kind==='audio'?speechMeta:{}),
                  voiceId: voice,
                  ...(kind === 'audio' && speechSource !== 'current' ? { speechSource } : {}),
                  estimates: es,
                });
                close();
              })
            }
          >
            <Sparkles />
            Запустить серию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function RemainingVideoDialog({ p, item, assets, upload, busy, perform, close, submit }: any) {
  const [snapshot] = useState<Project>(p);
  const [source] = useState<Item>(item);
  const m = selectedVideoModel(snapshot, source)!;
  const [batch] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState(() => remainingVideoPlans(snapshot).map(i => ({
    itemId: i.id, title: i.title, duration: videoShot(snapshot, i)!.duration,
    ref: videoFrame(snapshot, i) ?? '', prompt: videoPrompt(snapshot, i), include: true,
    frames: videoFrameOptions(snapshot, i),
  })));
  const [estimate, setEstimate] = useState(m.id==='grok-imagine-video-1.5'?(0.85+0.01*videoCharacterRefs(snapshot,'xai').length).toFixed(2):m.estimate === null ? '' : String(Number(BigInt(m.estimate)) / 1e10));
  const images = (assets as Asset[]).filter(a => ['image/png', 'image/jpeg', 'image/webp'].includes(a.mime));
  const included = rows.filter(r => r.include);
  let perAttempt: string | null = null, costError = '';
  try { if (estimate.trim()) perAttempt = ticks(estimate.trim()); }
  catch { costError = 'Укажите стоимость в USD, например 0.85.'; }
  const total = perAttempt === null ? null : (BigInt(perAttempt) * BigInt(included.length)).toString();
  const budget = totals(p);
  if (!costError && p.limit !== null) {
    if (total === null || budget.unknown) costError = 'При лимите укажите оценку и сверьте неизвестные списания в разделе расходов.';
    else if (BigInt(total) + BigInt(budget.actual) + BigInt(budget.reserved) > BigInt(p.limit)) costError = 'Эта серия превысит лимит проекта.';
  }
  const incomplete = videoCharacterRefs(snapshot,m.provider).length>7 || included.some(r => !r.ref || !r.prompt.trim() || videoGenerationPrompt(snapshot,snapshot.items.find(i=>i.id===r.itemId)!,r.prompt.trim()).length > VIDEO_PROMPT_LIMIT || r.duration > 6);
  const update = (itemId: string, changes: Partial<(typeof rows)[number]>) => setRows(current => current.map(r => r.itemId === itemId ? { ...r, ...changes } : r));
  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent className="sm:max-w-3xl modal-scroll">
        <DialogHeader>
          <DialogTitle>Создать оставшиеся видеопланы</DialogTitle>
          <DialogDescription>По одному ролику на отмеченный план. Готовые видео и попытки с неизвестным исходом пропущены. Результаты нужно будет просмотреть и утвердить по отдельности.</DialogDescription>
        </DialogHeader>
        <p><strong>{m.name}</strong> · модель выбранного варианта «{chosen(source)?.title}» в плане «{source.title}».</p>
        <Field label="Оценка одной попытки, USD" hint="Оценка не равна списанию. Если стоимость неизвестна, поле можно оставить пустым только при отсутствии лимита проекта.">
          <Input aria-label="Оценка одной попытки, USD" value={estimate} inputMode="decimal" onChange={e => setEstimate(e.target.value)} />
        </Field>
        <ZenCost modelId={m.id} refs={1} count={included.length}/>
        <p className="muted">Каждый исходный ролик: {generationSeconds(m.id)} сек. В монтаж войдёт длительность соответствующего плана.</p>
        <CharacterReferences p={snapshot} mode="video"/>
        {videoCharacterRefs(snapshot,m.provider).length>7&&<p role="alert">Grok Video принимает до 7 отдельных образов героев.</p>}
        {rows.map((r, index) => (
          <section key={r.itemId} className="editor-surface p-4 mb-3">
            <label className="row mb-3"><Checkbox checked={r.include} onCheckedChange={v => update(r.itemId, { include: !!v })} />
              <strong>{r.title} · {r.duration} сек</strong></label>
            {r.include && <>
              <div role="group" aria-label={`Первый кадр — ${r.title}`}>
                <strong>Первый кадр этого плана</strong>
                <p className="muted small">Все изображения этого плана. Галочкой отмечен кадр для генерации видео. Выберите одну картинку; утверждение раскадровки при этом не меняется.</p>
                <div className="reference-grid video-frame-grid">
                  {r.frames.map((frame, n) => <div key={frame.assetId}>
                    <label className={'reference ' + (r.ref === frame.assetId ? 'active' : '')}>
                      <img loading="lazy" src={'/api/assets/' + frame.assetId} alt={`${r.title} — ${frame.title}`} />
                      <Checkbox aria-label={`Выбрать кадр ${n + 1} — ${r.title}`} checked={r.ref === frame.assetId} disabled={busy}
                        onCheckedChange={checked => { if (checked) update(r.itemId, {ref: frame.assetId}); }} />
                      <span>{n + 1}. {frame.title} · {frame.model}{r.ref === frame.assetId ? ' · Выбран для видео' : ''}{frame.approved ? ' · Утверждён' : ''}</span>
                    </label>
                    <a className="text-sm underline" href={'/api/assets/' + frame.assetId} target="_blank" rel="noreferrer">Открыть изображение {n + 1}</a>
                  </div>)}
                </div>
                {!r.frames.length && <p className="muted">В карточке этого плана пока нет изображений. Выберите файл из библиотеки или загрузите его.</p>}
                {r.ref && !r.frames.some(f => f.assetId === r.ref) && <div className="reference active mt-3">
                  <img src={'/api/assets/' + r.ref} alt={`Выбранный первый кадр — ${r.title}`} />
                  <span><Check aria-hidden="true" size={16} />Выбран для видео · изображение из библиотеки или загрузки</span>
                </div>}
                {!r.ref && <p className="muted">Отметьте один первый кадр для этого плана.</p>}
                <details className="mt-3"><summary>Выбрать другое изображение из библиотеки</summary>
                  <Drop label={`Первый кадр из библиотеки — ${r.title}`} value={r.ref} onChange={ref => update(r.itemId, { ref })}
                    options={images.map((a, n) => ({ value: a.id, label: `${n + 1}. ${a.name}` }))} />
                </details>
                <Input aria-label={`Загрузить первый кадр — ${r.title}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) perform(async () => { const a = await upload(f); update(r.itemId, { ref: a.id }); }); e.target.value = ''; }} />
              </div>
              <PlanSpeechNote p={snapshot} item={snapshot.items.find(i=>i.id===r.itemId)!}/>
              <details className="mt-3"><summary>Проверить и изменить промпт · с героями и правилом речи {videoGenerationPrompt(snapshot,snapshot.items.find(i=>i.id===r.itemId)!,r.prompt.trim()).length} / {VIDEO_PROMPT_LIMIT}</summary>
                <Textarea className="edit-text short mt-3" aria-label={`Видеопромпт ${index + 1}`} value={r.prompt} onChange={e => update(r.itemId, { prompt: e.target.value })} />
                <p className="whitespace-pre-wrap">{videoGenerationPrompt(snapshot,snapshot.items.find(i=>i.id===r.itemId)!,r.prompt.trim())}</p>
              </details>
              {videoGenerationPrompt(snapshot,snapshot.items.find(i=>i.id===r.itemId)!,r.prompt.trim()).length > VIDEO_PROMPT_LIMIT && <p role="alert">Сократите задачу: вместе с героями и правилом речи промпт должен быть до {VIDEO_PROMPT_LIMIT} символов.</p>}
              {r.duration > 6 && <p role="alert">План длиннее 6 секунд. Исключите его из серии и разделите в сценарии.</p>}
            </>}
          </section>
        ))}
        <div className="generation-total"><div><span>Будет отправлено</span><strong>{included.length} попыток</strong></div>
          <div><span>Предварительная оценка серии</span><strong>{money(total)}</strong></div></div>
        {costError && <p role="alert">{costError}</p>}
        {incomplete && <p className="note">Выберите первые кадры для всех отмеченных планов и проверьте длину промптов.</p>}
        <p className="muted">Планы будут создаваться по очереди. Держите приложение открытым; после закрытия очередь продолжится при следующем открытии. Каждая попытка попадёт в журнал расходов. Утверждения остаются за вами.</p>
        <DialogFooter><Button variant="outline" onClick={close}>Закрыть</Button>
          <Button disabled={busy || !included.length || incomplete || !!costError} onClick={() => perform(async () => {
            await submit({ revision: snapshot.revision, batchId: batch, sourceItemId: source.id, sourceVariantId: chosen(source)!.id,
              estimate: perAttempt, plans: included.map(({ itemId, ref, prompt }) => ({ itemId, ref, prompt })) });
            close();
          })}><Sparkles />Запустить {included.length} планов</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function LipsyncDialog({p,connections,busy,perform,upload,close,submit,openStage}: any) {
  const [snapshot]=useState<Project>(p);
  const [batch]=useState(()=>crypto.randomUUID());
  const [inputType,setInputType]=useState<'image'|'video'>('image');
  const fromImage=inputType==='image';
  const [modelId,setModelId]=useState('sync-3');
  const [rate,setRate]=useState(SYNC_MODELS.find(m=>m.id==='sync-3')!.rate);
  const [status,setStatus]=useState('');
  const prepared=useRef(new Map<string,{visual:File;audio:File;seconds:number;width?:number;height?:number;visualAssetId?:string;audioAssetId?:string}>());
  const [rows,setRows]=useState(()=>snapshot.items.filter(i=>i.stage===7&&!i.planArchive).map(i=>({itemId:i.id,title:i.title,
    videoVariantId:originalLipsyncVideo(i),include:false,seconds:null as number|null,error:'',
    speaker:null as {x:number;y:number}|null,prompt:lipsyncImagePrompt(snapshot,i)})));
  const update=(id:string,patch:Partial<(typeof rows)[number]>)=>setRows(all=>all.map(r=>r.itemId===id?{...r,...patch}:r));
  const selected=rows.filter(r=>r.include);
  const configured=connections?.providers?.some((c:any)=>c.id==='sync'&&c.configured);
  let rateTicks='',costError='',cost:string|null=null;
  try { rateTicks=ticks(rate.trim()); if(BigInt(rateTicks)<=0n) throw new Error(); }
  catch { costError='Укажите положительную оценку тарифа за секунду, USD.'; }
  const imageInputsReady=!fromImage||selected.every(r=>r.speaker&&r.prompt.trim().length>0&&withCharacterIdentity(snapshot,r.prompt).length<=SYNC_IMAGE_PROMPT_LIMIT);
  if(!costError && selected.length && selected.every(r=>r.seconds!==null&&!r.error)&&imageInputsReady)
    cost=selected.reduce((sum,r)=>sum+BigInt(lipsyncEstimate(rateTicks,r.seconds!,inputType)),0n).toString();
  const budget=totals(p);
  if(!costError && p.limit!==null && cost!==null) {
    if(budget.unknown) costError='Сначала сверьте неизвестные списания в разделе расходов.';
    else if(BigInt(cost)+BigInt(budget.actual)+BigInt(budget.reserved)>BigInt(p.limit)) costError='Серия превысит лимит проекта.';
  }
  return <Dialog open onOpenChange={v=>!v&&!busy&&close()}><DialogContent className="sm:max-w-3xl modal-scroll">
    <DialogHeader><DialogTitle>Синхронизация губ · sync.so</DialogTitle>
      <DialogDescription>Отметьте планы, где герой произносит свою реплику в кадре. Для закадрового рассказа синхронизация не нужна. Каждый результат появится отдельным вариантом для просмотра и утверждения.</DialogDescription></DialogHeader>
    {fromImage&&<CharacterReferences p={snapshot} mode="sync"/>}
    <Field label="Как создать говорящий план"><Drop disabled={busy} label="Источник для синхронизации" value={inputType} onChange={value=>{
      setInputType(value as 'image'|'video');setRows(all=>all.map(r=>({...r,seconds:null,error:''})));setStatus('');
      if(value==='image'){setModelId('sync-3');setRate(SYNC_MODELS.find(m=>m.id==='sync-3')!.rate);}
    }} options={[{value:'image',label:'Из кадра раскадровки + озвучка · sync-3'},{value:'video',label:'Синхронизировать готовое видео'}]}/></Field>
    <p className="muted small">{fromImage?'sync-3 создаст видео прямо из утверждённой картинки и реплики. Предварительная генерация в Grok или MiniMax не нужна. Отметьте планы, затем нажмите на лицо говорящего в каждом изображении.':'Отметьте планы, выберите исходные ролики и проверьте утверждённые реплики. Замена голоса не требует повторной генерации исходного видео.'}</p>
    <p className="note">На стилизованной анимации результат нужно проверить вручную. Лучше подходит достаточно крупное лицо; движения камеры и действия из описания модель может воспроизвести не полностью.</p>
    {!configured&&<p role="alert">Добавьте ключ sync.so в разделе «Подключения», затем откройте это окно заново.</p>}
    <Field label="Модель синхронизации"><Drop disabled={busy} label="Модель синхронизации" value={modelId} onChange={id=>{setModelId(id);setRate(SYNC_MODELS.find(m=>m.id===id)!.rate);}}
      options={SYNC_MODELS.filter(m=>!fromImage||m.id==='sync-3').map(m=>({value:m.id,label:m.name+' — '+m.note}))} /></Field>
    <p className="muted small">{modelId==='sync-3' ? 'sync-3 умеет создавать движения закрытых губ. Это не гарантирует точность на мультяшных лицах.' : 'lipsync-2 и lipsync-2-pro требуют естественного движения рта уже в исходном видео. Для сцен с закрытыми губами выберите sync-3 или подготовьте ролик с говорящим героем.'} <a href="https://sync.so/docs/models/lipsync" target="_blank" rel="noreferrer">Ограничения моделей</a></p>
    {!fromImage&&<p className="muted small">Если выбран обработанный ролик, в списке ниже сначала подставляется его исходное видео, когда оно доступно. Утверждение плана от этого не меняется.</p>}
    <Field label="Ориентир тарифа, USD за секунду при 25 кадрах/с" hint={fromImage?'Для картинки используем ориентир 25 кадров/с. Фактический расход зависит от результата и тарифа sync.so.':'Оценка пересчитывается для подготовленного видео 24 кадра/с; она не является фактическим списанием.'}>
      <Input aria-label="Тариф sync.so" value={rate} disabled={busy} onChange={e=>setRate(e.target.value)} inputMode="decimal" /></Field>
    {rows.map(r=>{
      const item=snapshot.items.find(i=>i.id===r.itemId)!;
      let source:ReturnType<typeof lipsyncSource>|ReturnType<typeof lipsyncImageSource>|undefined,reason='';
      try { source=fromImage?lipsyncImageSource(snapshot,item.id):lipsyncSource(snapshot,item.id,r.videoVariantId); } catch(e) { reason=(e as Error).message; }
      if(snapshot.jobs.some(j=>j.itemId===item.id&&j.lipsync&&j.status==='unknown'&&j.actual===null)) reason='Есть попытка sync.so с неизвестным исходом. Сначала сверьте её в журнале расходов.';
      return <section className="editor-surface p-4" key={r.itemId}>
        <label className="row"><Checkbox aria-label={`Синхронизировать ${r.title}`} checked={r.include} disabled={busy||planSpeech(snapshot,item).speechType!=='character'} onCheckedChange={v=>update(r.itemId,{include:!!v})}/><strong>{r.title} · {speechNames[planSpeech(snapshot,item).speechType]}</strong></label>
        {planSpeech(snapshot,item).speechType!=='character'&&<p className="muted small">Закадровый голос не управляет губами персонажей. Изменить вид речи можно через «Правки» в озвучке, затем утвердить вариант. <Button size="sm" variant="link" onClick={()=>openStage(6)}>Открыть озвучку</Button></p>}
        {r.include&&reason&&<div role="status" className="note mt-2"><p>{reason}</p>
          <div className="row wrap"><Button size="sm" variant="outline" onClick={()=>openStage(6)}>Открыть озвучку</Button>
            <Button size="sm" variant="outline" onClick={()=>openStage(7,r.itemId)}>Открыть этот видеоплан</Button></div>
        </div>}
        {!fromImage&&<Field label="Исходное видео"><Drop disabled={busy} label={`Видео для синхронизации — ${r.title}`} value={r.videoVariantId} onChange={id=>update(r.itemId,{videoVariantId:id,seconds:null,error:'',include:false})}
          options={item.variants.filter(v=>v.kind==='video'&&v.assetId).map(v=>({value:v.id,label:v.title+(v.id===item.approvedId?' · утверждён':'' )}))}/></Field>}
        {r.include&&!fromImage&&item.variants.find(v=>v.id===r.videoVariantId)?.assetId&&<video className="w-full max-h-64 rounded" controls preload="metadata" src={'/api/assets/'+item.variants.find(v=>v.id===r.videoVariantId)!.assetId}/>}
        {r.include&&source&&'image' in source&&<>
          <p className="mt-3">Утверждённый кадр: {source.image.title}</p>
          <SpeakerPicker src={'/api/assets/'+source.image.assetId} title={r.title} value={r.speaker} disabled={busy} onChange={speaker=>update(r.itemId,{speaker,error:''})}/>
          <Field label="Действие, камера и стыковка" hint="Описание подтянуто из плана. Можно уточнить движения и удержать лицо героя в кадре всю реплику.">
            <Textarea aria-label={`Описание говорящего плана — ${r.title}`} value={r.prompt} disabled={busy} onChange={e=>update(r.itemId,{prompt:e.target.value,error:''})}/>
            <p className={withCharacterIdentity(snapshot,r.prompt).length>SYNC_IMAGE_PROMPT_LIMIT?'error':'muted small'}>С героями: {withCharacterIdentity(snapshot,r.prompt).length} / {SYNC_IMAGE_PROMPT_LIMIT} символов</p>
          </Field>
        </>}
        {r.include&&source&&<>
          <p className="mt-3"><strong>{source.audio.speaker} · реплика в кадре:</strong> {source.audio.dialogue||source.audio.text}</p>
          <audio controls preload="none" src={'/api/assets/'+source.audio.assetId} className="w-full mt-2"/>
          <p className="muted small">{'video' in source?`Видео с ${source.video.trim} сек · `:''}Речь с {source.audio.trim} сек. Подготовка сохранит полную реплику и добавит тишину до конца плана, если нужно.</p>
          {r.seconds!==null&&<p>{r.seconds.toFixed(3)} сек на обработку · {rateTicks?money(lipsyncEstimate(rateTicks,r.seconds,inputType)):'уточните тариф'}</p>}
        </>}
        {r.include&&r.error&&<p role="alert">{r.error}</p>}
      </section>;
    })}
    <Button variant="outline" disabled={busy||!selected.length} onClick={()=>perform(async()=>{
      for(const row of selected) {
        setStatus('Проверяем длительности: '+row.title);
        try {
          const s=fromImage?lipsyncImageSource(snapshot,row.itemId):lipsyncSource(snapshot,row.itemId,row.videoVariantId);
          if(fromImage&&(!row.speaker||!row.prompt.trim()||withCharacterIdentity(snapshot,row.prompt).length>SYNC_IMAGE_PROMPT_LIMIT))
            throw new Error('Отметьте лицо говорящего и проверьте длину описания.');
          const cacheKey=[inputType,row.itemId,'image' in s?s.image.id:s.video.id,s.audio.id].join(':');
          let media=prepared.current.get(cacheKey);
          if(!media) {
            if('image' in s){const out=await prepareLipsyncImage(s.image,s.audio,s.duration,message=>setStatus(row.title+': '+message));
              media={visual:out.image,audio:out.audio,seconds:out.seconds,width:out.width,height:out.height};
            } else {const out=await prepareLipsyncMedia(s.video,s.audio,message=>setStatus(row.title+': '+message));
              media={visual:out.video,audio:out.audio,seconds:out.seconds};}
            prepared.current.set(cacheKey,media);
          }
          update(row.itemId,{seconds:media.seconds,error:''});
        } catch(e) { update(row.itemId,{seconds:null,error:(e as Error).message}); }
      }
      setStatus('Проверка завершена. Для готовых планов показана оценка подготовленных файлов. Если у плана есть ошибка, исправьте её или снимите галочку.');
    })}>Проверить длительности и оценку</Button>
    <p className="muted small">Проверка подготавливает файлы в браузере и может занять некоторое время. Запрос в sync.so отправляется только после платного запуска. До запуска не закрывайте это окно — подготовленные файлы хранятся в нём.</p>
    <div className="generation-total"><div><span>Выбрано планов</span><strong>{selected.length}</strong></div><div><span>Оценка серии</span><strong>{money(cost)}</strong></div></div>
    {status&&<p role="status">{status}</p>}{costError&&<p role="alert">{costError}</p>}
    {fromImage&&!imageInputsReady&&selected.length>0&&<p role="status">Для каждого отмеченного плана выберите лицо на картинке и проверьте описание.</p>}
    <p className="muted small">{fromImage?'В sync-3 отправятся сама картинка, точка на лице, описание движения и готовая запись речи. Промежуточное видео не создаётся.':'Подготовка приведёт видео к размеру до 1280 × 720 и сохранит выбранный участок.'} При финальной сборке используется утверждённая озвучка; повторная звуковая дорожка видео не накладывается.</p>
    <p className="muted small">Серия обрабатывается по очереди. Держите приложение открытым. Фактическую стоимость сверьте с кабинетом sync.so в журнале расходов.</p>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>Закрыть</Button>
      <Button disabled={busy||!configured||cost===null||!!costError} onClick={()=>perform(async()=>{
        const plans=[];
        for(const row of selected) {
          const source=fromImage?lipsyncImageSource(snapshot,row.itemId):lipsyncSource(snapshot,row.itemId,row.videoVariantId);
          const cacheKey=[inputType,row.itemId,'image' in source?source.image.id:source.video.id,source.audio.id].join(':');
          const files=prepared.current.get(cacheKey);
          if(!files || files.seconds!==row.seconds) throw new Error('Сначала нажмите «Проверить длительности и оценку» для выбранных планов.');
          setStatus(row.title+': сохраняем подготовленные файлы…');
          if(!files.visualAssetId) files.visualAssetId=(await upload(files.visual)).id;
          if(!files.audioAssetId) files.audioAssetId=(await upload(files.audio)).id;
          plans.push({itemId:row.itemId,audioVariantId:source.audio.id,seconds:files.seconds,audioAssetId:files.audioAssetId,
            ...('image' in source?{inputType:'image',imageVariantId:source.image.id,imageItemId:source.imageItem.id,imageAssetId:files.visualAssetId,
              imageWidth:files.width,imageHeight:files.height,speaker:row.speaker,prompt:row.prompt.trim()}:
              {inputType:'video',videoVariantId:source.video.id,videoAssetId:files.visualAssetId})});
        }
        await submit({revision:snapshot.revision,batchId:batch,model:modelId,rate:rateTicks,plans}); close();
      })}><Sparkles/>{fromImage?'Создать видео с речью':'Запустить платную синхронизацию'} · {selected.length}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function SpeakerPicker({src,title,value,disabled,onChange}:{src:string;title:string;value:{x:number;y:number}|null;disabled:boolean;onChange:(p:{x:number;y:number})=>void}) {
  const clamp=(n:number)=>Math.max(0,Math.min(1,n));
  return <div className="mt-2">
    <p className="muted small">Нажмите на лицо героя, который должен говорить. С клавиатуры: Tab на картинку, затем стрелки для перемещения отметки.</p>
    <button type="button" disabled={disabled} aria-label={`Выбрать говорящего на кадре — ${title}`} aria-pressed={!!value}
      className="relative block w-full overflow-hidden rounded cursor-crosshair focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime-400"
      style={{padding:0,border:0}} onClick={e=>{if(!e.detail){onChange(value??{x:.5,y:.5});return;}const r=e.currentTarget.getBoundingClientRect();onChange({x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)});}}
      onKeyDown={e=>{const directions:Record<string,[number,number]>={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]};const d=directions[e.key];if(d){e.preventDefault();onChange({x:clamp((value?.x??.5)+d[0]),y:clamp((value?.y??.5)+d[1])});}}}>
      <img src={src} alt={`Утверждённый кадр ${title}`} className="block w-full h-auto" draggable={false}/>
      {value&&<span aria-hidden="true" className="absolute w-7 h-7 rounded-full border-2 border-white bg-lime-400/70 shadow-lg pointer-events-none" style={{left:`${value.x*100}%`,top:`${value.y*100}%`,transform:'translate(-50%,-50%)'}}/>}
    </button>
    <p role="status" className="small mt-2">{value?'Говорящий отмечен. Можно нажать на другое лицо.':'Лицо ещё не выбрано.'}</p>
  </div>;
}
function VoiceSelector({provider,value,onChange,multiple,onToggle}: {provider?:string;value:string;onChange:(id:string)=>void;multiple?:string[];onToggle?:(voice:VoiceOption)=>void}) {
  const [search,setSearch]=useState('');
  const [manual,setManual]=useState(false);
  const [scopes,setScopes]=useState<Record<string,string>>({minimax:'russian',elevenlabs:'all'});
  const scope=scopes[provider ?? ''] ?? 'russian';
  const supported=provider==='minimax'||provider==='elevenlabs';
  const query=useInfiniteQuery({queryKey:['voices','catalog-v2',provider,scope],enabled:supported,initialPageParam:'',retry:false,staleTime:300000,
    queryFn:({pageParam})=>request(`/api/voices?provider=${encodeURIComponent(provider!)}&scope=${scope}&cursor=${encodeURIComponent(pageParam)}`) as Promise<{voices:VoiceOption[];nextCursor:string}>,
    getNextPageParam:page=>page.nextCursor||undefined});
  const voices=[...new Map((query.data?.pages.flatMap(p=>p.voices)??[]).map(v=>[v.id,v])).values()];
  const selected=voices.find(v=>v.id===value);
  const term=search.trim().toLocaleLowerCase();
  const matches=voices.filter(v=>(`${v.id} ${v.name} ${v.description} ${v.category} ${/russian/i.test(v.id+' '+v.description)?'русский':''}`).toLocaleLowerCase().includes(term));
  const options=matches.map(v=>({value:v.id,label:`${v.name}${v.russian ? ' · русский' : ''} — ${v.description.slice(0,110)}`}));
  if(selected && !matches.some(v=>v.id===value)) options.unshift({value,label:selected.name});
  return <section className="editor-surface p-4">
    <strong>Голос (Voice ID) · озвучка на русском</strong>
    {!supported ? <p>Сначала выберите одну модель озвучки.</p> : <>
      <Field label="Каталог голосов"><Drop label="Каталог голосов" value={scope} onChange={next=>{setScopes(s=>({...s,[provider!]:next}));setSearch('');}}
        options={[{value:'russian',label:'С меткой «русский» у провайдера'},{value:'all',label:'Расширенный · все голоса аккаунта'}]} /></Field>
      <Field label="Поиск голоса"><Input aria-label="Поиск голоса" placeholder="Название, характер, язык или ID" value={search} onChange={e=>setSearch(e.target.value)} /></Field>
      {multiple ? <div className="space-y-2 max-h-80 overflow-y-auto" aria-label="Голоса для сравнения">{matches.map(v=><label key={v.id} className="row items-start rounded border p-3"><Checkbox aria-label={`Сравнить голос ${v.name}`} checked={multiple.includes(v.id)} onCheckedChange={()=>onToggle?.(v)}/><span><strong>{v.name}</strong><br/><span className="muted">{v.description}</span><br/><small>{v.category}{v.russian?' · русский':''} · {v.id}</small></span></label>)}</div>
        : <Field label="Выберите голос"><Drop label="Выберите голос" value={selected ? value : ''} options={options} onChange={onChange} /></Field>}
      {value && !selected && query.isSuccess && <p className="muted small">Сохранённый ID «{value}» не найден в загруженной части каталога. Переключите каталог, загрузите ещё голоса или проверьте ID вручную.</p>}
      {query.isPending && <p role="status">Загружаем голоса из вашего аккаунта…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && !matches.length && <p>По этому запросу голосов не найдено.</p>}
      {selected && <p><strong>{selected.name}</strong> · {selected.category}<br />{selected.description}<br />{selected.russian ? 'Русский язык указан провайдером.' : 'Русский язык не указан в метаданных голоса. Проверьте произношение на короткой реплике.'}<br /><small>ID: {selected.id}</small></p>}
      <p className="muted small">{scope==='russian' ? 'Показаны голоса с явной меткой русского языка. Для большего выбора откройте расширенный каталог.' : 'Модель поддерживает русский текст и многоязычную озвучку. У голосов без русской метки возможен акцент.'} Загружено: {voices.length}. Описания могут быть на английском.</p>
      {provider==='elevenlabs' && <p className="muted small">Чтобы добавить ещё голоса, сохраните их из Voice Library в своём аккаунте ElevenLabs, затем обновите список. Доступ через API зависит от вашего тарифа.</p>}
      <div className="row wrap"><Button type="button" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Обновить список</Button>
        {query.hasNextPage && <Button type="button" variant="outline" disabled={query.isFetching} onClick={()=>void query.fetchNextPage()}>Загрузить ещё голоса</Button>}
        {!multiple&&<Button type="button" variant="ghost" onClick={()=>setManual(v=>!v)}>{manual?'Скрыть ручной ввод':'Ввести ID вручную'}</Button>}</div>
    </>}
    {manual && supported && <Field label="Voice ID вручную"><Input aria-label="Voice ID вручную" value={value} onChange={e=>onChange(e.target.value)} /></Field>}
  </section>;
}
function VoiceComparisonPanel({p,connections,busy,perform,action,replace,onContinue}:any) {
  const choices=MODELS.filter(m=>m.kind==='audio'&&connections?.providers?.some((c:any)=>c.id===m.provider&&c.configured));
  const [modelId,setModelId]=useState(choices.some(m=>m.id===p.preferredVoice?.model)?p.preferredVoice.model:choices[0]?.id??'');
  const [phrase,setPhrase]=useState('Помнишь, как мы встретились у моря? Этот день я никогда не забуду.');
  const [voices,setVoices]=useState<{model:string;voiceId:string;name:string}[]>([]);
  const [estimate,setEstimate]=useState('');
  const [batch,setBatch]=useState(()=>crypto.randomUUID());
  const [notice,setNotice]=useState('');
  const m=choices.find(m=>m.id===modelId);
  const active=p.jobs.some((j:any)=>['queued','dispatching','pending','saving'].includes(j.status));
  let perAttempt:string|null=null,costIssue='';
  try{if(estimate.trim())perAttempt=ticks(estimate.trim());}catch{costIssue='Укажите оценку в USD, например 0.02.';}
  const total=perAttempt===null?null:(BigInt(perAttempt)*BigInt(voices.length)).toString();
  const budget=totals(p);
  if(p.limit!==null&&!costIssue){if(total===null||budget.unknown)costIssue='При лимите укажите оценку и сверьте неизвестные списания в журнале.';else if(BigInt(total)+BigInt(budget.actual)+BigInt(budget.reserved)>BigInt(p.limit))costIssue='Сравнение превысит лимит проекта.';}
  const change=()=>{setBatch(crypto.randomUUID());setNotice('');};
  return <section aria-label="Сравнение голосов" className="space-y-5 mb-6">
    <div className="editor-surface p-5 space-y-4"><h2>Одна фраза — несколько голосов</h2>
      <Field label="Фраза для сравнения" hint="Только произносимые слова. Одинаковый текст будет отправлен каждому выбранному голосу."><Textarea aria-label="Фраза для сравнения" maxLength={500} value={phrase} onChange={e=>{setPhrase(e.target.value);change();}}/><small>{phrase.length} / 500</small></Field>
      <Field label="Модель для выбора голосов"><Drop label="Модель для сравнения голосов" value={modelId} options={choices.map(m=>({value:m.id,label:m.name}))} onChange={setModelId}/></Field>
      {!choices.length&&<p>Добавьте API-ключ MiniMax или ElevenLabs в «Подключениях».</p>}
      <VoiceSelector provider={m?.provider} value="" onChange={()=>{}} multiple={voices.filter(v=>v.model===modelId).map(v=>v.voiceId)} onToggle={v=>{
        const exists=voices.some(x=>x.model===modelId&&x.voiceId===v.id);
        if(!exists&&voices.length>=8){setNotice('В одном сравнении можно выбрать до 8 голосов.');return;}
        setVoices(xs=>exists?xs.filter(x=>!(x.model===modelId&&x.voiceId===v.id)):[...xs,{model:modelId,voiceId:v.id,name:v.name}]);change();
      }}/>
      <div><strong>Выбрано: {voices.length} / 8</strong><div className="row wrap mt-2">{voices.map(v=><Button key={v.model+':'+v.voiceId} variant="outline" onClick={()=>{setVoices(xs=>xs.filter(x=>x!==v));change();}}>{v.name} · {MODELS.find(m=>m.id===v.model)?.name}<X size={14}/></Button>)}</div></div>
      <Field label="Оценка одной пробы, USD" hint="Для контроля бюджета. Если лимит не задан, можно оставить пустым."><Input aria-label="Оценка пробы голоса" inputMode="decimal" value={estimate} onChange={e=>{setEstimate(e.target.value);change();}}/></Field>
      <p>Будет создано {voices.length} проб · оценка {money(total)}. Генерация проб платная; расходы сохраняются в общем журнале. Повторное прослушивание готового файла не запускает генерацию.</p>
      {notice&&<p role="status">{notice}</p>}{costIssue&&<p role="alert">{costIssue}</p>}
      <Button disabled={busy||active||!voices.length||!phrase.trim()||!!costIssue} onClick={()=>perform(async()=>{
        replace(await request(`/api/projects/${p.id}/generate-voice-tests`,'POST',{revision:p.revision,batchId:batch,phrase,voices:voices.map(v=>({...v,estimate:perAttempt}))}));
        setBatch(crypto.randomUUID());setNotice('Пробы добавлены в очередь. Результаты появятся ниже; держите студию открытой.');
      })}><Mic/>Создать пробы · {voices.length}</Button>
    </div>
    {p.preferredVoice&&<div className="info-banner"><div><strong>Для озвучки выбран: {p.preferredVoice.name}</strong><p>{MODELS.find(m=>m.id===p.preferredVoice.model)?.name} · этот голос подставится при следующей генерации реплик. Готовые записи сохранят свои голоса.</p></div><Button onClick={onContinue}>К озвучке планов<ArrowRight/></Button></div>}
    {[...p.voiceComparisons??[]].filter(c=>!c.removedAt).reverse().map(c=><section className="editor-surface p-5" key={c.id}><div className="row spread"><strong>«{c.phrase}»</strong><Button variant="ghost" disabled={busy} onClick={()=>perform(()=>action('removeVoiceComparison',{comparisonId:c.id}))}><Trash2/>Удалить сравнение</Button></div><div className="grid gap-4 mt-4 md:grid-cols-2">
      {c.samples.map((s:any)=>{const j=p.jobs.find((j:any)=>j.id===s.jobId),selected=p.preferredVoice?.model===s.model&&p.preferredVoice?.voiceId===s.voiceId;return <article className="editor-surface p-4 space-y-3" key={s.jobId}><h3>{s.name}</h3><p>{MODELS.find(m=>m.id===s.model)?.name} · {j?statuses[j.status]:''}</p>
        {s.assetId&&<audio controls preload="none" className="w-full" src={'/api/assets/'+s.assetId} onPlay={e=>{e.currentTarget.closest('section[aria-label]')?.querySelectorAll('audio').forEach(a=>{if(a!==e.currentTarget)a.pause();});}}/>}
        <p className="muted">{j?.actual!==null&&j?.actual!==undefined?'Списано: '+money(j.actual):'Оценка: '+money(j?.estimate)+' · фактическая стоимость уточняется'}</p>
        {j?.error&&<p role="alert">{j.error}</p>}
        {j?.status==='unknown'&&!s.assetId&&<Button variant="outline" disabled={busy} onClick={()=>perform(async()=>replace(await request(`/api/projects/${p.id}/jobs/${j.id}`,'POST',{action:'recover-voice-file'})))}>Восстановить сохранённую пробу</Button>}
        <Button variant={selected?'secondary':'outline'} disabled={busy||!s.assetId||j?.status!=='done'} onClick={()=>perform(()=>action('chooseVoiceTest',{jobId:s.jobId}))}>{selected?<Check/>:<Mic/>}{selected?'Выбран для озвучки':'Выбрать для озвучки'}</Button>
      </article>;})}</div></section>)}
    {p.voiceComparisons?.some((c:any)=>c.removedAt)&&<details className="editor-surface p-4"><summary>Удалённые сравнения</summary>{p.voiceComparisons.filter((c:any)=>c.removedAt).map((c:any)=><div className="row spread py-3" key={c.id}><span>{c.phrase}</span><Button variant="outline" disabled={busy} onClick={()=>perform(()=>action('restoreVoiceComparison',{comparisonId:c.id}))}>Восстановить</Button></div>)}</details>}
  </section>;
}
function AnimaticPanel({p,busy,perform,action,onContinue}:any) {
  const selected=p.animatic?.variants.find((v:Variant)=>v.id===p.animatic?.selectedId),issue=animaticIssue(p,selected),approved=animaticApproved(p);
  const legacy=p.items.filter((i:Item)=>i.stage===6).flatMap((i:Item)=>i.variants.filter(v=>v.kind==='video').map(v=>({item:i,v})));
  return <section className="space-y-5 mb-6" aria-label="Выбор и утверждение аниматика">
    <div className="editor-surface p-5"><h2>{approved?'Аниматик утверждён':'Просмотрите и утвердите аниматик'}</h2><p>Кнопка «Собрать аниматик» создаёт отдельный MP4 из кадров и выбранных реплик. Утверждение аниматика не меняет утверждения голосов.</p>
      {!approved&&issue&&<p role="status">{issue}</p>}
      <div className="row wrap mt-4"><Button disabled={busy||!!issue||approved} onClick={()=>perform(()=>action('approveAnimatic',{variantId:selected.id}))}><Check/>{approved?'Утверждено':'Утвердить аниматик'}</Button><Button variant="outline" onClick={onContinue}>К видеопланам<ArrowRight/></Button></div>
    </div>
    <div className="grid gap-5 md:grid-cols-2">{[...p.animatic?.variants??[]].reverse().map((v:Variant)=><article className="editor-surface p-4 space-y-3" key={v.id}><h3>{v.title}</h3><Media v={v}/><p>{v.id===p.animatic?.selectedId?'Выбран · ':''}{v.id===p.animatic?.approvedId&&!animaticIssue(p,v)?'Утверждён':animaticIssue(p,v)||'Готов к просмотру'}</p>
      <div className="row wrap"><Button variant={v.id===p.animatic?.selectedId?'secondary':'outline'} disabled={busy} onClick={()=>perform(()=>action('selectAnimatic',{variantId:v.id}))}>{v.id===p.animatic?.selectedId&&<Check/>}Выбрать</Button><Button variant="ghost" disabled={busy} onClick={()=>perform(()=>action('deleteAnimatic',{variantId:v.id}))}><Trash2/>Удалить</Button><a href={'/api/assets/'+v.assetId} target="_blank" rel="noreferrer">Открыть файл</a></div>
    </article>)}</div>
    {!!p.animatic?.removedVariants?.length&&<details className="editor-surface p-4"><summary>Удалённые аниматики</summary>{p.animatic.removedVariants.map((v:Variant)=><div className="row spread py-3" key={v.id}><span>{v.title}</span><Button variant="outline" disabled={busy} onClick={()=>perform(()=>action('restoreAnimatic',{variantId:v.id}))}>Восстановить</Button></div>)}</details>}
    {!!legacy.length&&<details className="editor-surface p-5"><summary>Прежние аниматики · {legacy.length}</summary><p>Эти файлы были собраны до разделения этапов. Для утверждения соберите новый аниматик с текущими голосами.</p>{legacy.map(({item,v}:{item:Item;v:Variant})=><div key={v.id} className="mt-4"><strong>{v.title}</strong><Media v={v}/><Button variant="ghost" disabled={busy} onClick={()=>perform(()=>action('deleteVariant',{variantId:v.id},item.id))}>Удалить</Button></div>)}</details>}
  </section>;
}
function SpeechBatchDialog({ p, connections, busy, perform, close, submit }: any) {
  const [snapshot] = useState<Project>(p);
  const choices = MODELS.filter(m => m.kind === 'audio' && connections?.providers?.some((c: any) => c.id === m.provider && c.configured));
  const previous = snapshot.items.filter(i => i.stage === 6&&!i.planArchive).flatMap(i => i.variants).filter(v => v.kind === 'audio' && v.voiceId).at(-1);
  const preferred=choices.some(m=>m.id===p.preferredVoice?.model)?p.preferredVoice:undefined;
  const [modelId, setModelId] = useState(preferred?.model ?? choices.find(m => m.id === previous?.model)?.id ?? choices.find(m => m.id === 'speech-2.8-hd')?.id ?? choices[0]?.id ?? '');
  const [voice, setVoice] = useState(preferred?.voiceId ?? previous?.voiceId ?? '');
  const [estimate, setEstimate] = useState('');
  const [batch] = useState(() => crypto.randomUUID());
  const [parsed] = useState(() => { try { return { rows: speechPlans(snapshot), error: '' }; } catch(e) { return { rows: [], error: (e as Error).message }; } });
  const [rows, setRows] = useState(() => parsed.rows.map(r => ({ ...r, include: !r.hasAudio && !r.blocked })));
  const included = rows.filter(r => r.include && !r.blocked);
  let perAttempt: string | null = null, error = parsed.error;
  try { if (estimate.trim()) perAttempt = ticks(estimate.trim()); } catch { error = 'Укажите оценку в USD, например 0.02.'; }
  const total = perAttempt === null ? null : (BigInt(perAttempt) * BigInt(included.length)).toString();
  const budget = totals(p);
  if (p.limit !== null && !error) {
    if (total === null || budget.unknown) error = 'При лимите укажите оценку и сверьте неизвестные списания.';
    else if (BigInt(total) + BigInt(budget.actual) + BigInt(budget.reserved) > BigInt(p.limit)) error = 'Серия превысит лимит проекта.';
  }
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent className="sm:max-w-3xl modal-scroll">
    <DialogHeader><DialogTitle>Подготовить озвучку по планам</DialogTitle>
      <DialogDescription>По одной аудиозаписи на отмеченный план. Проверьте реплики и стоимость перед запуском. Готовые варианты нужно прослушать и утвердить в своих карточках.</DialogDescription></DialogHeader>
    <Field label="Модель озвучки"><Drop label="Модель озвучки" value={modelId} options={choices.map(m => ({value:m.id,label:m.name}))}
      onChange={value => { setModelId(value); setVoice(''); }} /></Field>
    {!choices.length && <p role="alert">Добавьте ключ модели озвучки в «Подключениях».</p>}
    <VoiceSelector provider={choices.find(m => m.id === modelId)?.provider} value={voice} onChange={setVoice} />
    <div className="row wrap"><Button variant="outline" onClick={() => setRows(rs => rs.map(r => ({...r, include:!r.blocked})))}>Выбрать все планы</Button>
      <Button variant="outline" onClick={() => setRows(rs => rs.map(r => ({...r, include:!r.blocked && !r.hasAudio})))}>Только без озвучки</Button></div>
    {rows.map((r,index) => <section className="editor-surface p-4" key={r.frameId}>
      <label className="row"><Checkbox disabled={r.blocked} checked={r.include} onCheckedChange={v => setRows(rs => rs.map(x => x.frameId === r.frameId ? {...x,include:!!v} : x))} />
        <strong>{r.title} · {r.duration} сек · начало {r.offset} сек</strong></label>
      <small>{r.blocked ? 'Есть незавершённая попытка или неизвестный исход; повтор заблокирован.' : r.hasAudio ? 'Запись уже есть. При включении создастся дополнительный вариант.' : 'Будет создана отдельная запись.'}</small>
      {r.include && <><SpeechModeFields value={r} allowNone={false} onChange={info=>setRows(rs=>rs.map(x=>x.frameId===r.frameId?{...x,...info}:x))}/>
        <Field label={r.speechType==='character'?'Реплика героя в кадре':'Закадровый текст'}><Textarea aria-label={`Реплика плана ${index+1}`} className="mt-3" value={r.dialogue} onChange={e => setRows(rs => rs.map(x => x.frameId === r.frameId ? {...x,dialogue:e.target.value} : x))} /></Field></>}
    </section>)}
    <Field label="Оценка одной записи, USD" hint="Оценка для контроля бюджета; фактическое списание учитывается отдельно. Без лимита можно оставить пустым."><Input aria-label="Оценка одной записи, USD" value={estimate} onChange={e => setEstimate(e.target.value)} /></Field>
    <div className="generation-total"><div><span>Будет создано</span><strong>{included.length} записей</strong></div><div><span>Оценка серии</span><strong>{money(total)}</strong></div></div>
    <p>После запуска включится режим «По планам». Общая запись сохранится в истории и не будет накладываться поверх реплик. Аниматик подстроит длительность кадров под полные реплики без ограничения в 60 секунд. Если речь не поместится в готовый видеоролик, переозвучьте этот план с более короткой репликой.</p>
    <p className="muted">Держите приложение открытым для обработки очереди. Повторная генерация платная; сохранённые файлы не удаляются.</p>
    {error && <p role="alert">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={close}>Закрыть</Button><Button disabled={busy || !modelId || !voice.trim() || !included.length || !!error || included.some(r => !r.dialogue.trim() || r.dialogue.length > 9500 || (r.speechType==='character'&&!r.speaker.trim()))}
      onClick={() => perform(async () => { await submit({revision:snapshot.revision,batchId:batch,model:modelId,voiceId:voice.trim(),estimate:perAttempt,plans:included.map(r => ({frameId:r.frameId,dialogue:r.dialogue,speechType:r.speechType,speaker:r.speaker}))}); close(); })}>
      <Mic />Создать {included.length} записей</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function StoryboardBatchDialog({ p, assets, connections, busy, perform, close, submit, referenceAction }: any) {
  const [snapshot, setSnapshot] = useState<Project>(p);
  const choices = MODELS.filter(m => m.kind === 'image' && connections?.providers?.some((c: any) => c.id === m.provider && c.configured));
  const [modelId, setModelId] = useState(choices[0]?.id ?? '');
  const m = choices.find(x => x.id === modelId);
  const [batch] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState(() => storyboardBatchPlans(snapshot).map(({ item, hasImage, blocked }) => ({
    itemId: item.id, title: item.title, hasImage, blocked, include: !hasImage && !blocked,
    prompt: storyboardPrompt(snapshot, item),
  })));
  const [refs, setRefs] = useState<string[]>(() => selectedReferences(snapshot,characterImageRefs(snapshot,{stage:5} as Item,approvedCharacters(snapshot).length?[]:[...new Set(snapshot.items.filter(i => i.stage === 3 && isApproved(snapshot, i))
    .flatMap(i => i.variants.filter(v => v.id === i.approvedId && v.kind === 'image' && v.assetId).map(v => v.assetId!)))].slice(0, 5))));
  const [override, setOverride] = useState<string | undefined>();
  const effectiveRefs=selectedReferences(snapshot,refs);
  const excludedRefs=hiddenReferences(snapshot);
  const images = (assets as Asset[]).filter(a => ['image/png', 'image/jpeg', 'image/webp'].includes(a.mime)&&!excludedRefs.has(a.id));
  const included = rows.filter(r => r.include && !r.blocked);
  const base = m?.id === 'grok-imagine-image-2.0' ? (400000000n + BigInt(effectiveRefs.length) * 100000000n).toString() : m?.estimate ?? null;
  let estimate = base, costError = '';
  try { if (override !== undefined) estimate = override.trim() ? ticks(override.trim()) : null; }
  catch { costError = 'Укажите стоимость в USD, например 0.05.'; estimate = null; }
  const total = estimate === null ? null : (BigInt(estimate) * BigInt(included.length)).toString();
  const budget = totals(p);
  if (!costError && p.limit !== null) {
    if (total === null || budget.unknown) costError = 'При лимите укажите оценку и сверьте неизвестные списания в разделе расходов.';
    else if (BigInt(total) + BigInt(budget.actual) + BigInt(budget.reserved) > BigInt(p.limit)) costError = 'Серия превысит лимит проекта.';
  }
  const refLimit = m?.provider === 'xai' ? 5 : 8;
  const miniRefError=isFalImage(modelId)?falRefIssue(effectiveRefs.map(id=>(assets as Asset[]).find(a=>a.id===id)).filter((a):a is Asset=>!!a)):isMiniMaxImage(modelId)?miniMaxImageRefIssue(effectiveRefs.map(id=>(assets as Asset[]).find(a=>a.id===id)).filter((a):a is Asset=>!!a)):'';
  const compiled=new Map(rows.map(r=>[r.itemId,storyboardImageRequest(snapshot,snapshot.items.find(i=>i.id===r.itemId)!,r.prompt,effectiveRefs,1,1,modelId)]));
  const promptErrors=new Map(rows.map(r=>[r.itemId,storyboardImagePromptIssue(compiled.get(r.itemId)!,modelId,r.title)]));
  return <Dialog open onOpenChange={v => !v && close()}>
    <DialogContent className="sm:max-w-3xl modal-scroll">
      <DialogHeader><DialogTitle>Создать кадры всех планов</DialogTitle>
        <DialogDescription>Одна модель, одна картинка для каждого отмеченного плана. Задачи взяты из выбранных вариантов карточек; к запросам добавится утверждённая основа фильма. Новые картинки появятся в своих карточках без автоматического утверждения.</DialogDescription>
      </DialogHeader>
      <Field label="Модель изображений"><Drop label="Модель изображений" value={modelId} onChange={value => { setModelId(value); setOverride(undefined); }}
        options={choices.map(x => ({ value: x.id, label: x.name }))} /></Field>
      {!choices.length && <p role="alert">Добавьте ключ модели изображений в «Подключениях».</p>}
      {isFalImage(modelId)&&<p className="note">Qwen Image Edit: кадры создаются с выбранными референсами и утверждёнными образами героев. Промпт сокращён до бюджета студии в 5000 символов; проверьте его перед запуском.</p>}
      {isZenCreatorImage(modelId)&&<p className="note">ZenCreator: промпт каждого кадра подготовлен в пределах 5000 символов. Проверьте действие, героев и стиль в разделе «Промпт для модели»; исходные описания остаются целиком.</p>}
      {isMiniMaxImage(modelId)&&<p className="note">MiniMax image-01: описание каждого кадра сокращается до 1500 символов. Перед запуском проверьте «Промпт для модели» в отмеченных планах. Референсы PNG/JPEG меньше 10 МБ; общий размер до 20 МБ. Используется сохранённый ключ MiniMax.</p>}
      {miniRefError&&<p role="alert">{miniRefError}</p>}
      <p><strong>По 1 картинке на план.</strong> Планы с готовыми изображениями изначально не отмечены. Можно включить их, чтобы получить новый вариант с сохранением прежних.</p>
      <div className="row wrap"><Button variant="outline" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: !r.blocked })))}>Выбрать все планы</Button>
        <Button variant="outline" onClick={() => setRows(rs => rs.map(r => ({ ...r, include: !r.hasImage && !r.blocked })))}>Только без картинок</Button></div>
      {rows.map((r, index) => <section key={r.itemId} className="editor-surface p-4">
        <label className="row"><Checkbox disabled={!!r.blocked} checked={r.include} onCheckedChange={v => setRows(rs => rs.map(x => x.itemId === r.itemId ? { ...x, include: !!v } : x))} />
          <span><strong>{r.title}</strong><small className="block muted">{r.blocked || (r.hasImage ? 'Есть изображение · будет создан новый вариант' : 'Картинки пока нет')}</small></span></label>
        {r.include && !r.blocked && <details className="mt-3"><summary>Проверить задачу из карточки · {r.prompt.trim().length} / 20000</summary>
          <Textarea className="edit-text short mt-3" aria-label={`Задача для кадра ${index + 1}`} value={r.prompt}
            onChange={e => setRows(rs => rs.map(x => x.itemId === r.itemId ? { ...x, prompt: e.target.value } : x))} />
          {(!r.prompt.trim() || r.prompt.trim().length > 20000) && <p role="alert">Введите задачу длиной от 1 до 20000 символов.</p>}
          <p>Промпт со стилем, героями и референсами: {compiled.get(r.itemId)!.length}{isOpenAIImage(modelId)?' / 32000':isMiniMaxImage(modelId)?' / 1500':isZenCreatorImage(modelId)||isFalImage(modelId)?' / 5000':''} символов.</p>
          <details><summary>Промпт для модели</summary><p className="whitespace-pre-wrap">{compiled.get(r.itemId)!.prompt}</p></details>
        </details>}
        {r.include&&!r.blocked&&promptErrors.get(r.itemId)&&<p role="alert">{promptErrors.get(r.itemId)}</p>}
      </section>)}
      <Field label="Общие референсы героев и стиля" hint={`Только отмеченные изображения отправятся с каждым планом. Можно снять любую галочку, включая образы героев. Всего до ${refLimit} референсов.`}>
        <div className="reference-grid">{images.map((a, index) => <div className={'reference ' + (effectiveRefs.includes(a.id) ? 'active' : '')} key={a.id}>
          <label><img src={'/api/assets/' + a.id} alt={a.name} />
          <Checkbox checked={effectiveRefs.includes(a.id)} disabled={!effectiveRefs.includes(a.id) && effectiveRefs.length >= refLimit}
            onCheckedChange={v => setRefs(current => v ? [...current, a.id] : current.filter(x => x !== a.id))} />
          <span>{index + 1}. {a.name}</span></label>
          <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Убрать из референсов: ${a.name}`} onClick={()=>perform(async()=>{setSnapshot(await referenceAction(a.id));setRefs(current=>current.filter(id=>id!==a.id));})}><Trash2 size={14}/>Убрать из списка</Button>
        </div>)}</div>
        {!!snapshot.hiddenReferenceIds?.length&&<details><summary>Убранные референсы</summary>{(assets as Asset[]).filter(a=>snapshot.hiddenReferenceIds!.includes(a.id)).map(a=><div className="row" key={a.id}><span>{a.name}</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>perform(async()=>setSnapshot(await referenceAction(a.id,true)))}>Вернуть в список</Button></div>)}</details>}
      </Field>
      {effectiveRefs.length > refLimit && <p role="alert">С учётом героев выбрано {effectiveRefs.length} референсов. Уберите дополнительные изображения или выберите модель с большим лимитом (до {refLimit} у текущей модели).</p>}
      <ZenCost modelId={modelId} refs={effectiveRefs.length} count={included.length}/>
      <Field label="Оценка одной картинки, USD" hint="Оценка не равна списанию. Неизвестную стоимость можно оставить пустой при отсутствии лимита проекта.">
        <Input aria-label="Оценка одной картинки, USD" inputMode="decimal" value={override ?? (base === null ? '' : String(Number(BigInt(base)) / 1e10))} onChange={e => setOverride(e.target.value)} />
      </Field>
      <div className="generation-total"><div><span>Будет создано</span><strong>{included.length} картинок</strong></div>
        <div><span>Оценка всей серии</span><strong>{money(total)}</strong></div></div>
      {costError && <p role="alert">{costError}</p>}
      <p className="muted">Кадры обрабатываются параллельно. Держите приложение открытым; очередь продолжится при следующем открытии, если вы её закроете. Все попытки учитываются в расходах.</p>
      <DialogFooter><Button variant="outline" onClick={close}>Закрыть</Button>
        <Button disabled={busy || !m || !included.length || !!costError || !!miniRefError || effectiveRefs.length > refLimit || included.some(r => !r.prompt.trim() || r.prompt.trim().length > 20000 || !!promptErrors.get(r.itemId))} onClick={() => perform(async () => {
          await submit({ revision: snapshot.revision, batchId: batch, model: modelId, refs:effectiveRefs, referenceMode:'selected', estimate,
            plans: included.map(({ itemId, prompt }) => ({ itemId, prompt })) }); close();
        })}><Sparkles />Сгенерировать {included.length} картинок</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
function ZenCost({modelId,refs=0,count=1}: {modelId:string;refs?:number;count?:number}) {
  const cost=zenCredits(modelId,refs);
  if(cost===undefined)return null;
  return <p className="note">ZenCreator: ориентир {cost} кредитов за попытку · {cost*count} за серию ({count}). Это оценка по каталогу, а не подтверждённое списание. Кредиты не переводятся в USD автоматически; для лимита проекта укажите собственную оценку в USD.</p>;
}
function Connections({ data, refresh, perform, busy }: any) {
  const [zenCheck,setZenCheck]=useState<any>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ИНСТРУМЕНТЫ СТУДИИ</div>
          <h1>Подключения</h1>
          <p className="muted">
            Ключи шифруются на сервере и не возвращаются в браузер.
          </p>
        </div>
      </div>
      {!data?.vaultReady && (
        <div className="info-banner">
          Хранилище ключей подготавливается. Ручная работа с проектами доступна.
        </div>
      )}
      <div className="connection-grid">
        {PROVIDERS.map((provider) => {
          const configured = data?.providers?.find(
            (x: any) => x.id === provider.id,
          )?.configured;
          return (
            <article className="connection-card" key={provider.id}>
              <div className="row spread">
                <h2>{provider.name}</h2>
                <span
                  className={'status-pill ' + (configured ? 'approved' : '')}
                >
                  {configured ? 'Ключ сохранен' : 'Нет ключа'}
                </span>
              </div>
              <p>
                {[...MODELS, ...SYNC_MODELS].filter((m) => m.provider === provider.id)
                  .map((m) => m.name)
                  .join(' · ')}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const key = String(new FormData(form).get('key'));
                  perform(async () => {
                    await request('/api/connections', 'POST', {
                      provider: provider.id,
                      key,
                    });
                    if(provider.id==='zencreator')setZenCheck(null);
                    form.reset();
                    refresh();
                  });
                }}
              >
                <Field label="API-ключ">
                  <Input
                    name="key"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={10}
                    placeholder={
                      configured ? 'Заменить ключ' : 'Вставьте ключ провайдера'
                    }
                  />
                </Field>
                <div className="row wrap">
                  <Button type="submit" disabled={busy || !data?.vaultReady}>
                    Сохранить
                  </Button>
                  <Button
                    variant="ghost"
                    render={
                      <a href={provider.url} target="_blank" rel="noreferrer" />
                    }
                  >
                    Кабинет
                    <ExternalLink size={14} />
                  </Button>
                  {configured && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() =>
                        perform(async () => {
                          await request('/api/connections', 'DELETE', {
                            provider: provider.id,
                          });
                          if(provider.id==='zencreator')setZenCheck(null);
                          refresh();
                        })
                      }
                    >
                      Удалить ключ
                    </Button>
                  )}
                </div>
              </form>
              {provider.id==='fal'&&<p className="note">Создайте ключ со scope API в кабинете fal.ai и вставьте его целиком. Один ключ подключает Qwen Image Edit для образов и раскадровки, MiniMax H3 Max и Wan 2.2 A14B для видеопланов. Оценка расходов показана перед запуском; фактическое списание проверяйте в fal.ai. Сохранение ключа бесплатно.</p>}
              {provider.id==='zencreator'&&<div className="note">
                <p>Создайте ключ с правами read и generate. Оплата — кредитами ZenCreator; отдельная проверка читает каталог и баланс, без генерации.</p>
                <Button variant="outline" disabled={busy||!configured} onClick={()=>perform(async()=>{setZenCheck(null);setZenCheck(await request('/api/connections/zencreator'));})}>Проверить ключ и баланс</Button>
                {zenCheck&&<div role="status"><p>Ключ работает · баланс: {zenCheck.credits} кредитов · {new Date(zenCheck.checkedAt).toLocaleString('ru-RU')}</p>
                  <p>Проверено право чтения. Право генерации проверится при запуске выбранной модели.</p>
                  <details><summary>Доступ к моделям</summary>{zenCheck.models.map((m:any)=><p key={m.id}>{m.name}: {m.available?'доступна':'недоступна'}{m.kind==='image'?(m.references?' · с референсами':' · референсы недоступны'):''}</p>)}</details>
                </div>}
              </div>}
              <small className="muted">
                Доступ к модели проверяется при генерации; сохранение ключа не
                выполняет платных запросов.
              </small>
            </article>
          );
        })}
        <article className="connection-card unavailable">
          <div className="row spread">
            <h2>World Labs · Atlas</h2>
            <Lock size={18} />
          </div>
          <p>
            Ожидает доступа к API. Официальная публикация описывает ранний
            доступ для партнеров; публичная схема интеграции не подтверждена.
          </p>
          <Button
            variant="outline"
            render={
              <a
                href="https://www.worldlabs.ai/blog/atlas"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            О модели
            <ExternalLink size={14} />
          </Button>
          <small className="muted">
            Готовые изображения и видео Atlas можно загружать как свои варианты.
          </small>
        </article>
      </div>
    </>
  );
}
function Budget({ p, action, perform, replace }: any) {
  const t = totals(p);
  const [job, setJob] = useState<any>(null);
  const [recovering,setRecovering] = useState('');
  const [showArchive,setShowArchive] = useState(false);
  const [archiving,setArchiving] = useState(false);
  const sorted=newestJobs(p.jobs),archived=sorted.filter(journalArchived);
  const visible=sorted.filter(j=>showArchive?journalArchived(j):!journalArchived(j));
  const clearable=sorted.filter(j=>canArchiveJob(j)&&!journalArchived(j)).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">РАСХОДЫ ПРОЕКТА</div>
          <h1>Каждая попытка на виду</h1>
          <p className="muted">
            Учитываются все результаты, включая отклоненные и ошибочные.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const rows = [
              [
                'Дата',
                'Модель',
                'Статус',
                'Оценка кредитов ZenCreator',
                'Оценка USD',
                'Факт USD',
                'Источник',
                'Запрос',
              ],
              ...sorted.map((j: any) => [
                j.created,
                j.model,
                statuses[j.status],
                String(j.zenCreditsEstimate ?? ''),
                j.estimate === null ? '' : String(Number(j.estimate) / 1e10),
                j.actual === null ? '' : String(Number(j.actual) / 1e10),
                j.actualSource ?? '',
                j.requestId ?? j.id,
              ]),
            ];
            const csv = rows
              .map((r) =>
                r
                  .map(
                    (s: string) => '"' + String(s).replaceAll('"', '""') + '"',
                  )
                  .join(';'),
              )
              .join('\r\n');
            download(
              new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
              'Расходы.csv',
            );
          }}
        >
          <Download />
          Скачать CSV
        </Button>
      </div>
      <div className="metrics">
        <div>
          <span>Подтверждено</span>
          <strong>{money(t.actual)}</strong>
        </div>
        <div>
          <span>Оценка в работе</span>
          <strong>{money(t.reserved)}</strong>
        </div>
        <div>
          <span>Нужно уточнить</span>
          <strong>{t.unknown} попыток</strong>
        </div>
        <div>
          <span>Лимит фильма</span>
          <strong>{p.limit === null ? 'Без лимита' : money(p.limit)}</strong>
        </div>
      </div>
      <div className="row wrap">
        <Button variant="outline" disabled={archiving||!clearable} onClick={()=>perform(async()=>{setArchiving(true);try{await action('archiveJournal');}finally{setArchiving(false);}})}>Очистить журнал{clearable?` · ${clearable}`:''}</Button>
        <Button variant="ghost" onClick={()=>setShowArchive(v=>!v)}>{showArchive?'Вернуться в журнал':`Показать архив · ${archived.length}`}</Button>
        {showArchive&&<Button variant="outline" disabled={archiving||!archived.length} onClick={()=>perform(async()=>{setArchiving(true);try{await action('restoreJournal');setShowArchive(false);}finally{setArchiving(false);}})}>Вернуть записи из архива</Button>}
      </div>
      <p className="muted">{showArchive?'Архив':'Журнал'} · {visible.length} записей · сначала новые. Очистка переносит завершённые попытки в архив без удаления файлов и расходов. Активные запросы и неизвестные исходы остаются в журнале. CSV содержит все записи, включая архив.</p>
      <div className="table-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Модель / время</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Оценка</TableHead>
              <TableHead>Факт</TableHead>
              <TableHead>Действие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((j: any) => (
              <TableRow key={j.id}>
                <TableCell>
                  <strong>
                    {[...MODELS, ...SYNC_MODELS].find((m) => m.id === j.model)?.name ?? j.model}
                  </strong>
                  {j.purpose==='voice-test'&&<small>Проба голоса · {j.voiceName||j.voiceId}</small>}
                  <small>{new Date(j.created).toLocaleString('ru-RU')}</small>
                  {j.requestId && <small>Запрос: {j.requestId}</small>}
                </TableCell>
                <TableCell>
                  {statuses[j.status]}
                  {j.error && <small className="warning-text">{j.error}</small>}
                </TableCell>
                <TableCell>{money(j.estimate)}{j.zenCreditsEstimate!==undefined&&<small>≈ {j.zenCreditsEstimate} кредитов ZenCreator</small>}</TableCell>
                <TableCell>
                  {money(j.actual)}
                  <small>{j.actualSource ?? 'Списание не подтверждено'}</small>
                  {j.zenCreditsEstimate!==undefined&&<small>Фактические кредиты: сверьте в кабинете ZenCreator. Оценка не считается списанием.</small>}
                  {isOpenAIImage(j.model)&&openAIImageTariff(j.usage)!==null&&<small>Расчёт по токенам без скидки за кэш: {money(openAIImageTariff(j.usage))}</small>}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setJob(j)}>
                    Сверить
                  </Button>
                  {j.status === 'failed' && j.lipsync && j.requestId && <>
                    <Button size="sm" variant="outline" disabled={!!recovering}
                      aria-label={`Получить результат повторно — ${j.requestId}`}
                      onClick={()=>perform(async()=>{setRecovering(j.id);try{
                        replace(await request(`/api/projects/${p.id}/jobs/${j.id}`,'POST',{action:'recover-result'}));
                      }finally{setRecovering('')}})}>
                      {recovering===j.id?'Проверяем результат…':'Получить результат повторно'}
                    </Button>
                    <small>Проверка сохранённого запроса без новой генерации.</small>
                  </>}
                  {j.status === 'queued' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        perform(() => action('cancel', { jobId: j.id }))
                      }
                    >
                      Отменить
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!visible.length && (
          <div className="empty-table">
            <Wallet />
            <h2>{showArchive?'Архив пуст':p.jobs.length?'Журнал очищен':'Генераций пока нет'}</h2>
            <p>
              После запуска серии здесь появятся оценки, статусы и фактические
              списания.
            </p>
          </div>
        )}
      </div>
      <div className="note">
        Провайдеры не всегда возвращают стоимость в ответе API. Неизвестное
        списание можно сверить с кабинетом и внести вручную. Тарифы оценки Grok:
        снимок от 08.09.2026; актуальный счет имеет приоритет.
      </div>
      <Dialog open={!!job} onOpenChange={(v) => !v && setJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сверка списания</DialogTitle>
            <DialogDescription>
              {job?.model} · укажите сумму из кабинета провайдера. Для возврата
              укажите итог после возврата.
            </DialogDescription>
          </DialogHeader>
          {job?.model === 'gpt-6-astra' && job.usage && (
            <p className="muted">
              Использовано токенов: вход — {job.usage.input_tokens ?? 'нет данных'},
              выход — {job.usage.output_tokens ?? 'нет данных'} (включая рассуждения).
              Это данные об объеме работы; фактическую сумму внесите из кабинета OpenAI.
            </p>
          )}
          {job&&isOpenAIImage(job.model)&&job.usage&&<div className="note"><p>Токены: текст на входе — {job.usage.input_tokens_details?.text_tokens??'нет данных'}, изображения на входе — {job.usage.input_tokens_details?.image_tokens??'нет данных'}, выход — {job.usage.output_tokens??'нет данных'}.</p>
            <p>Расчёт по полным тарифам: {money(openAIImageTariff(job.usage))}. Возможная скидка за кэш здесь не учтена. Фактическое списание сверьте в кабинете OpenAI.</p></div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              perform(async () => {
                await action('reconcile', {
                  jobId: job.id,
                  actual: ticks(String(f.get('actual'))),
                  note: String(f.get('note')),
                });
                setJob(null);
              });
            }}
          >
            <Field label="Фактически списано, USD">
              <Input
                name="actual"
                required
                inputMode="decimal"
                placeholder="0.85"
              />
            </Field>
            <Field label="Источник / комментарий">
              <Input
                name="note"
                required
                placeholder="Счет или запись из кабинета"
              />
            </Field>
            <Button type="submit">Сохранить сверку</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
function SettingsDialog({ open, close, p, busy, perform, save }: any) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Параметры фильма</DialogTitle>
          <DialogDescription>
            Изменение хронометража или формата потребует повторного утверждения
            материалов.
          </DialogDescription>
        </DialogHeader>
        <form
          key={p.revision + String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            perform(async () => {
              await save({
                title: f.get('title'),
                seconds: Number(f.get('seconds')),
                format: f.get('format'),
                limit: f.get('limit') ? ticks(String(f.get('limit'))) : null,
              });
              close();
            });
          }}
        >
          <Field label="Название">
            <Input
              name="title"
              defaultValue={p.title}
              required
              maxLength={100}
            />
          </Field>
          <Field label="Целевой хронометраж, секунд" hint="Ориентир для сценария. Сборка использует фактическую длительность кадров и реплик.">
            <Input
              type="number"
              name="seconds"
              min="1"
              defaultValue={p.seconds}
              required
            />
          </Field>
          <Field label="Формат">
            <Select name="format" defaultValue={p.format}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 · горизонтальный</SelectItem>
                <SelectItem value="9:16">9:16 · вертикальный</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Лимит расходов, USD"
            hint="Пустое поле — без ограничения. При лимите серия с неизвестной оценкой не отправляется."
          >
            <Input
              name="limit"
              defaultValue={
                p.limit === null ? '' : String(Number(p.limit) / 1e10)
              }
              inputMode="decimal"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                download(
                  new Blob([JSON.stringify(p, null, 2)], {
                    type: 'application/json',
                  }),
                  p.title + '.json',
                )
              }
            >
              <Download />
              Архив описаний
            </Button>
            <Button type="submit" disabled={busy}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function BulkApproval({ p, stage, busy, action, perform }: any) {
  const rows = approvalBatch(p, stage);
  const ready = rows.filter(r => !r.reason);
  const blocked = rows.filter(r => r.reason);
  const changed = stage===6 ? changedSpeechSelections(p) : [];
  const speechSelections = changed.map(i=>({itemId:i.id,variantId:i.selectedId!}));
  let speechReason='';
  if(changed.length) try { approveSelectedSpeech(structuredClone(p),speechSelections); } catch(e) { speechReason=(e as Error).message; }
  return <section className="editor-surface p-5 mb-5" aria-label="Массовое утверждение">
    <strong>Утверждение выбранных вариантов</strong>
    <p>Готово к утверждению: {ready.length}. Требуют внимания: {blocked.length}. Уже утверждённые карточки сохранят свой вариант.</p>
    <p>В каждой карточке будет утверждён вариант с пометкой «Выбран». Чтобы изменить выбор, откройте карточку перед нажатием кнопки.</p>
    <Button className="h-auto whitespace-normal" disabled={busy || !ready.length}
      onClick={() => perform(() => action('approveBatch', {stage, selections: ready.map(({itemId, variantId}) => ({itemId, variantId}))}))}>
      <Check />Утвердить все неутверждённые · {ready.length}
    </Button>
    {blocked.length > 0 && <details className="mt-3"><summary>Какие карточки требуют внимания · {blocked.length}</summary>
      <ul>{blocked.map(r => <li key={r.itemId}><strong>{r.title}</strong>: {r.reason}</li>)}</ul>
    </details>}
    {changed.some(i=>i.approvedId) && <div className="mt-4">
      <p>Вы выбрали новые голоса. Аниматик использует выбранные записи; для следующих этапов утвердите замену прежних голосов.</p>
      <Button disabled={busy||!!speechReason} onClick={()=>perform(()=>action('approveSelectedSpeech',{selections:speechSelections}))}><Check/>Утвердить выбранные новые голоса · {changed.length}</Button>
      <details className="mt-2"><summary>Планы с новым выбором</summary><ul>{changed.map(i=><li key={i.id}>{i.title} — {chosen(i)?.title}</li>)}</ul></details>
      {speechReason&&<p role="alert">{speechReason}</p>}
    </div>}
    {!rows.length && !changed.length && <p role="status">Все карточки этого этапа утверждены.</p>}
  </section>;
}
function Timeline({ p, animatic, busy, onRender, action, perform }: any) {
  const stage = animatic ? 5 : 7;
  const items = p.items.filter((i: Item) => i.stage === stage && participates(p,i));
  const clips = items
    .map((i: Item) => i.variants.find((v) => v.id === i.approvedId))
    .filter(Boolean) as Variant[];
  let total = clips.reduce((s, v) => s + v.duration, 0);
  let audio = p.items
    .filter((i: Item) => i.stage === 6 && participates(p, i) && isApproved(p, i))
    .map((i: Item) => i.variants.find((v) => v.id === i.approvedId))
    .filter((v: Variant) => v?.kind === 'audio');
  let reason = '';
  let base: ReturnType<typeof editPlan> | undefined;
  try {
    base = editPlan(p, animatic);
    audio = base.audio;
  } catch (e) {
    reason = (e as Error).message;
  }
  const autoTiming = p.speechMode === 'plans';
  const timing = useQuery({
    queryKey: ['speech-durations', p.id, base?.audio.map(v => v.assetId)],
    enabled: autoTiming && !!base,
    queryFn: ({signal}) => Promise.all(base!.audio.map(v => audioDuration(v.assetId!, signal))),
    staleTime: Infinity,
    retry: false,
  });
  let fitted = base;
  if (autoTiming && base && timing.data) {
    try {
      fitted = fitPlanToSpeech(base, timing.data);
      audio = fitted.audio;
      total = fitted.seconds;
    } catch(e) { reason = (e as Error).message; }
  }
  return (
    <section className="timeline-surface">
      <div className="surface-heading">
        <div>
          <span>
            {animatic
              ? 'Аниматик из раскадровки'
              : 'Монтажная последовательность'}
          </span>
          <small>{total.toFixed(2)} сек{autoTiming && timing.data && !reason ? ' · с учётом реплик' : ''} · 1080p · 24 кадра/с</small>
        </div>
        <Button disabled={busy || !!reason || (autoTiming && timing.isFetching)} aria-describedby={reason?'assembly-blocker':undefined} onClick={onRender}>
          <Clapperboard />
          {animatic ? 'Собрать аниматик' : 'Собрать MP4'}
        </Button>
      </div>
      {reason&&<div id="assembly-blocker" role="alert" className="note mb-4"><strong>Почему сборка недоступна</strong><p>{reason}</p></div>}
      <div className="timeline-clips">
        {items.map((i: Item, n: number) => {
          const v = i.variants.find((v) => v.id === i.approvedId);
          return (
            <div className="timeline-clip" key={i.id}>
              <div className="row spread">
                <span className="eyebrow">
                  {String(n + 1).padStart(2, '0')}
                </span>
                <span>{fitted?.clips[n]?.duration.toFixed(2) ?? v?.duration ?? '—'} сек</span>
              </div>
              <strong>{i.title}</strong>
              {autoTiming && base && timing.data && <small>Кадр: {v?.duration.toFixed(2)} сек · Речь: {Math.max(0,...base.audioClipIndexes.flatMap((index, j)=>index===n?[timing.data[j]-base!.audio[j].trim]:[])).toFixed(2)} сек · В сборке: {fitted?.clips[n]?.duration.toFixed(2)} сек</small>}
              <small>
                {isApproved(p, i) ? 'Утвержден' : 'Требует утверждения'}
              </small>
              <div className="row">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Переместить план раньше"
                  disabled={busy || n === 0}
                  onClick={() =>
                    perform(() => action('moveItem', { direction: -1 }, i.id))
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Переместить план позже"
                  disabled={busy || n === items.length - 1}
                  onClick={() =>
                    perform(() => action('moveItem', { direction: 1 }, i.id))
                  }
                >
                  <ArrowDown size={14} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {audio.length > 0 && (
        <div className="audio-timeline">
          {audio.map((v: Variant) => (
            <div
              key={v.id}
              style={{
                marginLeft: `${(v.offset / Math.max(total,1)) * 100}%`,
                width: `${Math.max(0, Math.min(100-v.offset/Math.max(total,1)*100, Math.max(8, v.duration/Math.max(total,1)*100)))}%`,
              }}
            >
              <Mic size={13} />
              {v.title} · {v.offset.toFixed(2)}с
            </div>
          ))}
        </div>
      )}
      {animatic && <p className="note">Для аниматика используются голоса с пометкой «Выбран» в каждой карточке. Их утверждение для следующих этапов выполняется отдельно.</p>}
      <p className="muted small">{audio.length
        ? `В сборку войдёт звуковых дорожек: ${audio.length}.`
        : 'В сборке пока нет утверждённых звуковых дорожек.'}</p>
      {autoTiming && <p className="muted small">{timing.isFetching ? 'Измеряем длительность утверждённых реплик…' : timing.isError ? 'Не удалось заранее измерить реплики. Сборка повторит проверку по аудиофайлам.' : animatic ? 'Длительность кадров в аниматике подстраивается под полные реплики. Следующий кадр и его голос сдвигаются вместе.' : 'Длительность видеопланов подстраивается под полные реплики за счёт доступной части исходного ролика. Следующие видео и голоса сдвигаются вместе. Скорость воспроизведения сохраняется; при нехватке видео сборка укажет конкретный план.'}</p>}
      <p className="muted small">
        {reason ||
          (animatic ? 'Планы соединятся прямыми склейками. Выбранные дорожки речи и музыки добавятся по указанному времени.' : 'Планы соединятся прямыми склейками. Звук видео отключен; утвержденные дорожки речи и музыки добавятся по указанному времени.')}
      </p>
    </section>
  );
}
function LibraryPanel({ projects, current, assets, action, perform }: any) {
  const [source, setSource] = useState('');
  const q = useQuery<Project>({
    queryKey: ['library', source],
    queryFn: () => request('/api/projects/' + source),
    enabled: !!source,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ОБЩИЙ МИР ФИЛЬМОВ</div>
          <h1>Библиотека</h1>
          <p className="muted">
            Используйте утвержденных героев, атмосферу и образы из других
            фильмов.
          </p>
        </div>
      </div>
      <Field label="Фильм-источник">
        <Drop
          label="Выберите фильм"
          value={source}
          onChange={setSource}
          options={projects
            .filter((p: Summary) => p.id !== current?.id)
            .map((p: Summary) => ({ value: p.id, label: p.title }))}
        />
      </Field>
      {q.error && <p role="alert">{q.error.message}</p>}
      <div className="context-list">
        {q.data?.items
          .filter((i) => [1, 2, 3].includes(i.stage) && isApproved(q.data!, i))
          .map((i) => {
            const v = i.variants.find((v) => v.id === i.approvedId)!;
            return (
              <article className="context-card" key={i.id}>
                <div className="eyebrow">{STAGES[i.stage]}</div>
                <h2>{i.title}</h2>
                <Media v={v} />
                <p className="preserve">{readableText(v.text)}</p>
                <Button
                  disabled={!current}
                  onClick={() =>
                    perform(() =>
                      action('importLibrary', {
                        projectId: source,
                        itemId: i.id,
                      }),
                    )
                  }
                >
                  <Copy />
                  Добавить в текущий фильм
                </Button>
              </article>
            );
          })}
      </div>
      <p className="muted">
        Копия получает собственное утверждение. Изменения в исходном фильме не
        заменяют ее автоматически.
      </p>
      <div className="section-toolbar">
        <h2>Файлы текущего фильма</h2>
        <span className="muted">{assets.length} материалов</span>
      </div>
      <div className="asset-library">
        {assets.map((a: Asset) => (
          <article className="asset-tile" key={a.id}>
            {a.mime.startsWith('image/') ? (
              <img src={'/api/assets/' + a.id} alt={a.name} />
            ) : a.mime.startsWith('video/') ? (
              <Clapperboard />
            ) : (
              <Mic />
            )}
            <strong>{a.name}</strong>
            <small>{(a.size / 1024 / 1024).toFixed(1)} МБ</small>
            <Button
              variant="ghost"
              size="sm"
              render={<a href={'/api/assets/' + a.id} download={a.name} />}
            >
              <Download />
              Скачать
            </Button>
          </article>
        ))}
      </div>
      {!assets.length && (
        <p className="muted">
          Здесь будут загруженные и сгенерированные материалы.
        </p>
      )}
    </>
  );
}
