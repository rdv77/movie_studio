import {build} from 'esbuild';
import assert from 'node:assert/strict';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export {ensureDirecting} from './lib/directing';export * as S from './lib/script-workflow';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/screenplay-emotional-arc.mjs'});
const {D,S,ensureDirecting}=await import('../work/tests/screenplay-emotional-arc.mjs');
const arc={character:'Лётчица',want:'Доставить лекарство.',expectation:'Посадочная полоса будет освещена.',stakes:'Помощь нужна до рассвета.',emotionStart:'Деловая уверенность.',emotionEnd:'Решимость действовать осторожно.',beats:[{trigger:'Огни посадочной полосы гаснут.',meaning:'Она понимает, что привычная посадка невозможна.',emotionStart:'Уверенность.',emotionEnd:'Тревога, затем сосредоточенность.',decision:'Увести самолёт на круг и искать безопасный путь.',visibleEvidence:'Улыбка исчезает; она всматривается в темноту, затем уверенно меняет курс.'}]};
const candidate=(text='Лётчица замечает погасшие огни, тревожится и уводит самолёт на круг.')=>({title:'Кандидат',text,changes:[],findings:[],emotionalArcs:[structuredClone(arc)]});
function fixture(cameraPolicy='cinematic'){
  const p=D.newProject('Ночной рейс'),d=ensureDirecting(p);d.brief.cameraPolicy=cameraPolicy;
  const item=p.items.find(i=>i.stage===0),source=D.addVariant(p,item.id,{kind:'text',title:'Черновик',text:'Лётчица доставляет лекарство в горы.'});
  D.approve(p,item.id);return {p,d,item,source};
}
const context=prompt=>JSON.parse(prompt.split('Задание и замороженный контекст:\n').at(-1));
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS screenplay emotion:',name);}

test('all camera policies are valid in immutable workflow input and survive reload',()=>{
  for(const policy of ['static','cinematic','dynamic']){
    const {p,source}=fixture(policy),run=S.createScriptWorkflowRun(p,'test-model',['script-adaptation'],source.id);
    assert.equal(run.scriptInput.brief.cameraPolicy,policy);
    const saved=JSON.parse(JSON.stringify(p)),loaded=saved.directing.runs[0];
    assert.equal(S.scriptWorkflowPrompt(saved,loaded,loaded.tasks[0]),S.scriptWorkflowPrompt(p,run,run.tasks[0]));
    p.directing.brief.cameraPolicy='static';assert.equal(run.scriptInput.brief.cameraPolicy,policy);
  }
});

test('approved arcs flow into frozen input; unapproved candidate cannot replace them',()=>{
  const {p,item,source}=fixture();source.versionInfo.settings={emotionalArcs:[structuredClone(arc)]};
  const alternative=D.addVariant(p,item.id,{kind:'text',title:'Не выбран',text:'Другой сюжет'});
  alternative.versionInfo.settings={emotionalArcs:[{...arc,character:'Другой герой'}]};
  assert.deepEqual(S.screenplayEmotionalArcs(p),[arc]);
  const run=S.createScriptWorkflowRun(p,'test-model',['script-critic'],source.id);
  source.versionInfo.settings.emotionalArcs[0].want='Поздняя правка';
  assert.deepEqual(context(S.scriptWorkflowPrompt(p,run,run.tasks[0])).currentEmotionalArcs,[arc]);
  assert.equal(run.scriptInput.emotionalArcs[0].want,arc.want);
});

test('specialists preserve arc across critic, dramaturg, control and explicit import',()=>{
  const {p,item,source}=fixture(),run=S.createScriptWorkflowRun(p,'test-model',['script-adaptation','script-critic','script-dramaturg','script-control'],source.id);
  const [adaptation,critic,dramaturg,control]=run.tasks;
  S.applyScriptWorkflowResult(p,run,adaptation,candidate());
  assert.deepEqual(context(S.scriptWorkflowPrompt(p,run,critic)).currentEmotionalArcs,[arc]);
  const readOnly=candidate();delete readOnly.emotionalArcs;
  S.applyScriptWorkflowResult(p,run,critic,readOnly);
  assert.deepEqual(critic.result.emotionalArcs,[arc],'Read-only validation may not discard the map when provider omits it');
  assert.throws(()=>S.applyScriptWorkflowResult(p,run,dramaturg,readOnly),/потеряна эмоциональная линия/);
  assert.equal(dramaturg.result,undefined);
  const revised=candidate();revised.emotionalArcs[0].beats[0].visibleEvidence+=' Стиснутые пальцы разжимаются.';
  S.applyScriptWorkflowResult(p,run,dramaturg,revised);
  assert.deepEqual(context(S.scriptWorkflowPrompt(p,run,control)).currentEmotionalArcs,revised.emotionalArcs);
  const probe=structuredClone(p),probeRun=probe.directing.runs[0];S.applyScriptWorkflowResult(probe,probeRun,probeRun.tasks[3],candidate());assert.deepEqual(probeRun.tasks[3].result.emotionalArcs,revised.emotionalArcs);assert(probeRun.tasks[3].processingWarning);
  S.applyScriptWorkflowResult(p,run,control,{...readOnly});
  assert.deepEqual(control.result.emotionalArcs,revised.emotionalArcs);
  const selected=item.selectedId,approved=item.approvedId,imported=S.importScriptWorkflowCandidate(p,run.id,control.id);
  assert.deepEqual(imported.versionInfo.settings.emotionalArcs,revised.emotionalArcs);
  assert.equal(imported.text,revised.text);assert.equal(item.selectedId,selected);assert.equal(item.approvedId,approved);
  item.selectedId=imported.id;D.approve(p,item.id);
  assert.deepEqual(S.screenplayEmotionalArcs(p),revised.emotionalArcs);
  const newRun=S.createScriptWorkflowRun(p,'test-model',['script-producer'],imported.id);
  assert.deepEqual(newRun.scriptInput.emotionalArcs,revised.emotionalArcs);
});

test('branch from a result retains its own arc without borrowing another project or current selection',()=>{
  const {p,source}=fixture(),first=S.createScriptWorkflowRun(p,'test-model',['script-adaptation'],source.id);
  S.applyScriptWorkflowResult(p,first,first.tasks[0],candidate());
  const branch=S.createScriptWorkflowRun(p,'test-model',['script-dramaturg'],source.id,first.tasks[0].id);
  assert.deepEqual(branch.scriptInput.emotionalArcs,[arc]);assert.equal(branch.scriptInput.text,candidate().text);
  assert.deepEqual(S.screenplayEmotionalArcs(fixture().p),[]);
});

test('legacy result and malformed legacy metadata remain readable without fabricated arcs',()=>{
  const {p,source}=fixture(),legacy={title:'Старый ответ',text:'Лётчица летит.',changes:[],findings:[]};
  assert(S.scriptWorkflowResultSchema.safeParse(legacy).success);
  source.versionInfo.settings={emotionalArcs:'invalid'};
  assert.deepEqual(S.screenplayEmotionalArcs(p),[]);
  const run=S.createScriptWorkflowRun(p,'test-model',['script-critic'],source.id);
  S.applyScriptWorkflowResult(p,run,run.tasks[0],{...legacy,text:source.text});
  assert.equal(run.tasks[0].result.emotionalArcs,undefined);
  const bad=candidate();bad.emotionalArcs[0].beats[0].visibleEvidence=' ';
  assert(!S.scriptWorkflowResultSchema.safeParse(bad).success);
});

test('generic prompts require observable causal emotion, no story-specific example is injected',()=>{
  for(const role of S.SCRIPT_ROLES){
    const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'test-model',[role],source.id);
    const prompt=S.scriptWorkflowPrompt(p,run,run.tasks[0]);
    for(const required of ['ожидание → событие → осознание → переживание → выбор → видимое поведение','emotionalArcs','visibleEvidence','Сдержанная мимика','При запрете звука'])assert(prompt.includes(required));
    assert(!/лягуш|камыш|царевич|стрел[ауы]/i.test(prompt),'Prompt template must not hardcode this film');
  }
});

console.log(`PASS ${checks} screenplay emotional-arc checks. No provider calls.`);
