# R12: подключение студии голосов

Этот документ описывает оставшуюся интеграцию новых модулей. Изолированные helpers, API Voice Design и UI проверены локально. Single/batch очереди TTS уже сохраняют замороженную постановку и принимают профиль, а `projectAssetIds` сохраняет членство файлов проб. Делегирование в общем исполнительном коде, подключение TTS helper в провайдерах и основное окно студии ещё требуют интеграции после фиксации R09/R11.

## Интерфейс

```tsx
<VoiceStudioEditor
  key={p.id}
  p={p}
  model={directorModel}
  busy={busy}
  speechModel={speechModel}
  submit={(action,data)=>perform(async()=>{
    replace(await request(`/api/projects/${p.id}/voice-design`,{
      revision:p.revision,action,data,
    }));
  })}
/>
```

`speechModel` — необязательный ID модели TTS для предпросмотра. `model` — ID текстовой модели агента. Профиль поставщика должен соответствовать модели TTS; нельзя переносить Voice ID ElevenLabs в MiniMax. Явный общий выбор профиля обновляет `preferredVoice`: ElevenLabs → `eleven_v3`, MiniMax → `speech-2.8-hd`. Выбор не утверждает аудио и не меняет старые записи. `assignProfile` назначает голос конкретному плану; можно снять назначение через `profileId:null`.

## Очередь и провайдер

1. В normal single/batch TTS schemas добавлены optional `profileId:UUID` и `voiceDelivery:voiceDeliverySchema`. Пакетная озвучка допускает optional Voice ID/профиль/постановку в каждой строке; общие значения служат явными значениями по умолчанию. Профиль другой модели отклоняется до отправки. Окно сравнения существующих голосов может позднее использовать те же optional настройки, не меняя legacy фразу.
2. После извлечения чистой реплики и формирования каждого queued audio job, до бюджетной проверки и CAS, очереди уже вызывают:

```ts
freezeVoiceJob(p,job,{profileId:s.profileId,delivery:s.voiceDelivery});
```

Helper проверяет модель/профиль/якоря пауз до отправки, сохраняет immutable `voiceDelivery`, `voiceProfileId`, `ttsRequestText` и точное тело в `job.prompt`. Исходные слова остаются в `job.dialogue`. В пакетном режиме приоритет: явный профиль строки → назначение голосу этого плана → общий профиль серии → совпадающий с заданием глобальный профиль. Вызов batch helper использует `{profileId:row.profileId,fallbackProfileId:common.profileId,delivery:row.voiceDelivery??common.voiceDelivery}`. Без новых опций и без сохранённой постановки получается прежнее задание; чужой выбранный Voice ID не заменяется неявно.

3. В `providers.generate`, до legacy audio ветвей, после музыкальной ветви:

```ts
if(j.kind==='audio'&&(m.provider==='elevenlabs'||m.provider==='minimax')){
  const directed=await generateDirectedSpeech(j,key,m.provider);
  if(directed)return directed;
}
```

`generateDirectedSpeech` выполняет один запрос. Для legacy возвращает `undefined`. `VoiceSpeechResponseError.receipt` сохраняет подтверждённые `requestId`, `actual`, `usage` даже при некорректном аудио; jobs catch обязан перенести эту квитанцию перед назначением failed/unknown. Не объявлять actual=0 после отправки. Ошибка локальной проверки имеет notSent=true.

4. Normal jobs handler после owner/load/find перед обычным model lookup делегирует `purpose==='voice-design'` в `runVoiceWorkflowStep(user,p.id,j.id)`. Действие stop делегируется `stopVoiceWorkflow`. Эти job IDs для Voice Design могут быть синтетическими: нельзя вызывать для них `model(job.model)` из общего каталога. Обычная кнопка журнала показывает `job.brief`/provider/operation с безопасным fallback имени. Фоновый исполнитель использует тот же CAS executor и ограничение параллельности. Он не отправляет failed/unknown заново.
5. При создании готового аудиоварианта перенести `voiceDelivery`, `voiceProfileId`, `ttsRequestText` из job. Чистая реплика по-прежнему хранится отдельно. Проектный редактор сохраняет эти optional поля, когда вариант редактируют; повторный ввод описания не меняет использованную квитанцию.

## Принадлежность файлов

`projectAssetIds` уже добавляет:

```ts
for(const d of p.voiceStudio?.designs??[])for(const preview of d.previews)add(preview.assetId);
for(const profile of p.voiceStudio?.profiles??[])add(profile.previewAssetId);
for(const job of p.jobs)for(const preview of job.voiceWorkflow?.previews??[])add(preview.assetId);
```

Нельзя исключать soft-deleted design/profile или late результаты: они доступны для восстановления. Это только список кандидатов; `asset` всё равно проверяет собственника и принадлежность проекту. Не использовать внешний `voiceId` как file ID.

## Контроль длительности и кастинг

- `targetSeconds` — режиссёрский ориентир. Провайдер не получает выдуманный параметр гарантированной длительности. После генерации измеряется файл. При превышении видеоплана показываются обе длительности и варианты действий; монтаж не режет слова и не ускоряет запись автоматически.
- `intention` — контекст для агента, а не слова для TTS. Emotion/speed/паузы получают только документированные отображения. Eleven v3 использует tags вместо точного SSML времени, MiniMax — `<#x#>`; отличия видны в предпросмотре.
- Character-linked profiles хранят `characterId` текущего проекта. `voiceStudio.castings[itemId]` хранит явное назначение конкретному плану, независимое от общего профиля. Реплики рассказчика могут иметь самостоятельный профиль. Удаление профиля снимает назначения и общий выбор; восстановление не возвращает их автоматически.
- Выбор или новая постановка не переутверждает ранее записанный файл. После новой генерации режиссёр прослушивает, выбирает и утверждает новое аудио. Финальный монтаж использует только выбранную утверждённую запись.

## QA после интеграции

1. Старый проект без `voiceStudio`: открыть, прослушать старое аудио, новая legacy озвучка получает прежний API body; selected/approved сохраняются.
2. Сохранить существующий Voice ID как профиль; выбрать его; создать запись с emotion, speed и паузой. В речи нет заголовка героя, актёрской задачи или targetSeconds, журнал содержит точный запрос.
3. Создать ElevenLabs Voice Design: один платный mock job возвращает несколько проб. Прослушивание/выбор бесплатны. Save — отдельный явный create job. Изменение выбора после постановки Save в очередь не меняет frozen preview.
4. Создать 3 MiniMax пробы: три отдельных квитанции и суммарная резервируемая оценка. Save добавляет профиль без дополнительного API вызова.
5. Два parallel advance одного job отправляют один mock запрос. Unknown не повторяется, CAS conflict до dispatch не создаёт оплату, ручной stop сохраняет late результаты отдельно.
6. Неудачное сохранение файла повторяет только запись полученных bytes. Аудиопроба доступна через `/api/assets` только владельцу; другой проект не получает её через membership.
7. Поменять чистую реплику после задания агента: просмотр предложения доступен, применение отклоняется как устаревшее. После apply настройки формы обновляются без закрытия окна; старое аудио остаётся утверждённым.
8. Проверить 4.6-секундное аудио при 4-секундном видео: сообщение показывает числа и решения. Никаких скрытых скоростей, обрезки слов или повторных платных вызовов.

Проверки выполняются mock API и SSR, без платной генерации. Документированные первичные источники и ограничения перечислены в `voice-direction.md`.
