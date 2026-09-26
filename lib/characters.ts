import { planReferenceIds } from './plan-references';
import { selectedReferences } from './reference-selection';
import { isApproved, type Project, type Item, type CharacterBrief } from './domain';

export function approvedCharacters(p: Project) {
  return p.items.filter(i => i.stage === 1 && isApproved(p,i)).flatMap(item => {
    const variant = item.variants.find(v => v.id === item.approvedId)!;
    return variant.character && variant.kind === 'image' && variant.assetId
      ? [{itemId:item.id,variantId:variant.id,assetId:variant.assetId,profile:variant.character}] : [];
  });
}
export function characterPrompt(c: CharacterBrief) {
  return `Создай утверждаемый образ одного героя анимационного фильма: ${c.name}. Покажи только этого героя, в полный рост, с хорошо различимым лицом, на простом фоне. Не добавляй надписи, панели комикса или других персонажей.\n\nНеизменные черты: ${c.appearance}\nОписание и характер: ${c.description}\nЗадача режиссёра и работа с исходными изображениями: ${c.instructions || 'Создай образ по описанию.'}\n${c.refs.length ? 'Прикреплённые изображения — исходные прообразы этого героя. Сохрани узнаваемые черты, меняй только то, что указано в задаче.' : ''}`;
}
export function characterImageRefs(p: Project, item: Item, extra: string[]) {
  const fixed = item.character && item.stage === 1 ? item.character.refs
    : [5,7].includes(item.stage) ? planReferenceIds(p,item) : item.stage >= 4 ? approvedCharacters(p).map(c=>c.assetId) : [];
  return [...new Set([...fixed,...extra])];
}
export function characterReferenceNote(p: Project, refs: string[]) {
  const rows = approvedCharacters(p).filter(c=>refs.includes(c.assetId));
  return rows.length ? `\n\nРеференсы постоянных героев (порядок прикреплённых изображений):\n${rows.map(c=>`Изображение ${refs.indexOf(c.assetId)+1}: ${c.profile.name}. ${c.profile.appearance}`).join('\n')}\nИспользуй эти изображения как образцы внешности, а не как композицию сцены. Показывай только героев, участвующих в описанном действии. Не смешивай лица и одежду разных героев.` : '';
}
export function videoCharacters(p:Project,characterIds?:string[]) {
  const heroes=approvedCharacters(p);
  if(characterIds===undefined)return heroes;
  if(new Set(characterIds).size!==characterIds.length||characterIds.some(id=>!heroes.some(c=>c.itemId===id)))
    throw new Error('Список утверждённых героев изменился. Заново откройте серию и проверьте выбор.');
  return heroes.filter(c=>characterIds.includes(c.itemId));
}
export function withCharacterIdentity(p: Project, prompt: string, characterIds?:string[]) {
  const heroes = videoCharacters(p,characterIds);
  return heroes.length ? `${prompt}\n\nПостоянные герои: ${heroes.map(c=>`${c.profile.name}: ${c.profile.appearance || c.profile.description || 'внешность по утверждённому изображению'}`).join('; ')}. Сохрани лица, возраст, пропорции и одежду. Показывай только участников этого плана.` : prompt;
}
export function videoCharacterRefs(p: Project, provider: string, characterIds?:string[]) {
  const heroes=videoCharacters(p,characterIds);
  return provider === 'xai' ? selectedReferences(p,heroes.map(c=>c.assetId)) : [];
}
export function assertCharacterRefLimit(refs: string[], limit: number) {
  if (refs.length > limit) throw new Error(`С учётом утверждённых героев нужно ${refs.length} референсов, а модель принимает до ${limit}. Уберите дополнительные изображения или выберите модель с большим лимитом. Образы героев не исключаются автоматически.`);
}
