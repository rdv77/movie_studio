import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';

// Exercise the real editor functions and their effects across rerenders. The
// lightweight hook host avoids a browser/DOM dependency and never runs providers.
const hookHost = [
  'let active, nextId=0;',
  'export const Fragment=Symbol("Fragment");',
  'export const jsx=(type,props,key)=>({type,props:props??{},key}); export const jsxs=jsx;',
  'export function useState(initial){const host=active,index=host.cursor++;if(!host.hooks[index])host.hooks[index]={value:typeof initial==="function"?initial():initial};return [host.hooks[index].value,value=>{const next=typeof value==="function"?value(host.hooks[index].value):value;if(!Object.is(next,host.hooks[index].value)){host.hooks[index].value=next;host.pending=true;}}];}',
  'export function useRef(value){const host=active,index=host.cursor++;if(!host.hooks[index])host.hooks[index]={current:value};return host.hooks[index];}',
  'export function useId(){const [value]=useState(()=>"editor-"+(++nextId));return value;}',
  'export function useEffect(effect,deps){const host=active,index=host.cursor++,previous=host.hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){host.hooks[index]={deps};host.effects.push(effect);}}',
  'export function createHarness(Component,props){const host={Component,props,hooks:[],cursor:0,effects:[],pending:true,tree:null};const flush=()=>{let renders=0;while(host.pending){if(++renders>30)throw Error("Render loop");host.pending=false;host.cursor=0;host.effects=[];active=host;try{host.tree=Component(host.props);}finally{active=undefined;}for(const effect of host.effects)effect();}return host.tree;};flush();return {get tree(){return host.tree;},flush,updateProps(props){host.props=props;host.pending=true;return flush();}};}',
].join('\n');
const stubs=new Map([
  ['@/components/ui/button',['Button']],['@/components/ui/input',['Input']],['@/components/ui/textarea',['Textarea']],
  ['@/components/ui/dialog',['Dialog','DialogContent','DialogHeader','DialogTitle']],
  ['@/components/ui/tabs',['Tabs','TabsList','TabsTrigger','TabsContent']],
  ['./creative-controls',['CreativeStrengthControls','SceneCreativeControls','SceneCreativeSettings']],
  ['./world-editor',['SceneLocationEditor']],['./shot-direction-editor',['ShotDirectionEditor','ShotDirectionSummary','directionEditorIssues']],
  ['./montage-solutions',['MontageOperationPreview']],['./batch-scope-selector',['BatchScopeSelector']],
  ['./version-comparison',['VersionComparison']],
]);
// Optional negative control: bundle one editor from HEAD without changing the
// working tree, so the regression must fail against the original component.
const baselineEditor=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice('--baseline='.length);
if(baselineEditor)assert(['directing-editor','script-workflow-editor'].includes(baselineEditor));
const baselineSource=baselineEditor?execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'show','HEAD:app/'+baselineEditor+'.tsx'],{encoding:'utf8'}):undefined;
await build({
  stdin:{resolveDir:process.cwd(),contents:"export * as D from './lib/domain'; export * as S from './lib/script-workflow'; export {ensureDirecting} from './lib/directing'; export {DirectingEditor} from './app/directing-editor'; export {ScriptWorkflowEditor} from './app/script-workflow-editor'; export {createHarness} from 'react';"},
  bundle:true,platform:'node',format:'esm',outfile:'work/tests/script-editor-lifecycle.mjs',
  plugins:[{name:'editor-hook-host',setup(builder){
    if(baselineEditor)builder.onLoad({filter:/app[\\/](directing-editor|script-workflow-editor)\.tsx$/},args=>{
      if(args.path.endsWith(baselineEditor+'.tsx'))return {contents:baselineSource,loader:'tsx',resolveDir:dirname(args.path)};
    });
    builder.onResolve({filter:/^(react(\/jsx-runtime)?|@\/components\/ui\/|\.\/)/},args=>{
      if(args.path==='react'||args.path==='react/jsx-runtime')return {path:'react',namespace:'editor-test'};
      if(stubs.has(args.path)&&/app[\\/](directing-editor|script-workflow-editor)\.tsx$/.test(args.importer))return {path:args.path,namespace:'editor-test'};
    });
    builder.onLoad({filter:/.*/,namespace:'editor-test'},args=>({contents:args.path==='react'?hookHost:stubs.get(args.path).map(name=>'export function '+name+'(){return null;}').join('\n'),loader:'js'}));
  }}],
});
const {D,S,ensureDirecting,DirectingEditor,ScriptWorkflowEditor,createHarness}=await import('../work/tests/script-editor-lifecycle.mjs');
function nodes(tree){if(tree===null||tree===undefined||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children),...(tree.props?.renderActions?tree.props.versions.flatMap(v=>nodes(tree.props.renderActions(v))):[])];}
function find(tree,predicate){const found=nodes(tree).find(predicate);assert(found,'Expected UI element');return found;}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join('');return typeof tree==='object'?text(tree.props?.children):String(tree);}
const button=(tree,label)=>find(tree,node=>node.type?.name==='Button'&&text(node)===label);
const field=(tree,label)=>find(find(tree,node=>node.props?.label===label),node=>typeof node.props?.onChange==='function');
const sourceSelect=tree=>find(tree,node=>node.type==='select'&&node.props.id?.endsWith('-source'));
const previewLabel='Промпт первого выбранного шага';
const dirtyText='Есть несохранённые настройки.';
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
function fixture(title='Редактор сценария'){
  let p=D.newProject(title),response,host,script;
  const submissions=[];
  const submit=async(action,data)=>{
    assert.equal(action,'brief','Lifecycle checks must never enqueue a model');
    submissions.push(structuredClone(data));
    const snapshot=structuredClone(data);
    if(response)await response.promise;
    const next=structuredClone(p);ensureDirecting(next).brief=snapshot.brief;next.productionOrder=snapshot.productionOrder;next.revision++;
    // Deliberately render the saved parent before the await continuation. Ref-only
    // dirty clearing cannot update this render and must fail these checks.
    p=next;host.updateProps({...hostProps(),busy:false});syncScript();
  };
  const hostProps=()=>({p,stage:0,busy:false,submit,open:()=>{}});
  // The source/brief editor and specialist editor now live on separate pages.
  // Exercise their saved-state handoff without assuming one nests the other.
  const scriptProps=()=>({p,model:'gpt-6-astra',busy:text(host.tree).includes(dirtyText),submit});
  const syncScript=()=>{if(script)script.updateProps(scriptProps());};
  host=createHarness(DirectingEditor,hostProps());script=createHarness(ScriptWorkflowEditor,scriptProps());
  const refresh=()=>{host.flush();syncScript();};
  return {
    get p(){return p;},get tree(){return host.tree;},get script(){return script.tree;},submissions,refresh,
    update(change){p=structuredClone(p);change(p);host.updateProps(hostProps());syncScript();},
    addSource(value='Мальчик встречает лягушку в короне.'){let id;this.update(next=>{id=D.addVariant(next,next.items[0].id,{kind:'text',title:value,text:value}).id;});return id;},
    edit(label,value){field(host.tree,label).props.onChange({target:{value}});refresh();},
    clickPreview(){button(script.tree,previewLabel).props.onClick();script.flush();},
    pending(value){response=value;},async save(){await button(host.tree,'Сохранить творческое задание').props.onClick();refresh();},
  };
}
function enabled(f){assert.equal(button(f.script,previewLabel).props.disabled,false);for(const node of nodes(f.script).filter(n=>n.type?.name==='Button'&&text(n).startsWith('Только ')))assert.equal(node.props.disabled,false);}
function blocked(f){assert.equal(button(f.script,previewLabel).props.disabled,true);}
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS script editor lifecycle:',name);}
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('Lifecycle checks must not contact providers');};
try{
  await test('first source then saved brief enables preview without remount',async()=>{
    const f=fixture();blocked(f);const id=f.addSource();assert.equal(sourceSelect(f.script).props.value,id);blocked(f);
    f.edit('Какое чувство должен вызвать фильм','Тихое удивление');blocked(f);await f.save();enabled(f);
    assert(!text(f.tree).includes(dirtyText));const before=JSON.stringify(f.p);f.clickPreview();
    assert(text(f.script).includes('Тихое удивление'));assert.equal(JSON.stringify(f.p),before);assert.equal(f.submissions.length,1);assert.equal(f.p.jobs.length,0);
  });
  await test('saved brief then first source enables all script roles without remount',async()=>{
    const f=fixture();f.edit('Аудитория','Семья');await f.save();blocked(f);const id=f.addSource();
    assert.equal(sourceSelect(f.script).props.value,id);enabled(f);f.clickPreview();assert(text(f.script).includes('Семья'));assert.equal(f.p.jobs.length,0);
  });
  await test('explicit source and branch survive project updates and source restoration',async()=>{
    const f=fixture(),first=f.addSource('Первый исходник');await f.save();f.addSource('Второй исходник');
    assert.equal(sourceSelect(f.script).props.value,first);
    const select=sourceSelect(f.script);select.props.onChange({target:{value:first}});f.refresh();
    f.update(p=>{const run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],first);S.applyScriptWorkflowResult(p,run,run.tasks[0],{title:'Ветвь',text:'Кандидат для новой ветви.',changes:[],findings:[]});});
    button(f.script,'Продолжить с этого результата').props.onClick();f.refresh();f.addSource('Третий исходник');
    f.update(p=>{p.directing.brief.effect='Чувство новой ветви';});enabled(f);
    assert.equal(sourceSelect(f.script).props.value,first);assert(text(f.script).includes('Новая ветка от результата'));
    f.clickPreview();assert(text(f.script).includes('Кандидат для новой ветви.'));assert(text(f.script).includes('Чувство новой ветви'));
    f.update(p=>D.deleteVariant(p,p.items[0].id,first));blocked(f);assert.equal(sourceSelect(f.script).props.value,first);assert(text(f.script).includes('Новая ветка от результата'));
    f.update(p=>D.restoreVariant(p,p.items[0].id,first));enabled(f);assert.equal(sourceSelect(f.script).props.value,first);
  });
  await test('late brief edit remains dirty after the earlier save succeeds',async()=>{
    const f=fixture();f.addSource();await f.save();const wait=deferred();f.pending(wait);
    f.edit('Какое чувство должен вызвать фильм','Первое чувство');const saving=f.save();
    f.edit('Какое чувство должен вызвать фильм','Более позднее чувство');wait.resolve();await saving;
    assert.equal(f.p.directing.brief.effect,'Первое чувство');assert.equal(field(f.tree,'Какое чувство должен вызвать фильм').props.value,'Более позднее чувство');blocked(f);assert(text(f.tree).includes(dirtyText));
    f.pending(undefined);await f.save();enabled(f);f.clickPreview();assert(text(f.script).includes('Более позднее чувство'));
  });
  await test('production order edits are dirty and failed saves preserve the draft',async()=>{
    const f=fixture();f.addSource();await f.save();f.edit('Порядок производства','video-first');blocked(f);assert(text(f.tree).includes(dirtyText));
    const wait=deferred();f.pending(wait);const saving=f.save();wait.reject(Error('Local save failure'));await assert.rejects(saving,/Local save failure/);
    blocked(f);assert.equal(field(f.tree,'Порядок производства').props.value,'video-first');assert.equal(f.p.productionOrder,'voice-first');
    f.pending(undefined);await f.save();enabled(f);assert.equal(f.p.productionOrder,'video-first');assert(!text(f.tree).includes(dirtyText));
  });
  await test('late production order edit survives an in-flight brief save',async()=>{
    const f=fixture();f.addSource();await f.save();const wait=deferred();f.pending(wait);
    f.edit('Аудитория','Дети');const saving=f.save();f.edit('Порядок производства','video-first');wait.resolve();await saving;
    blocked(f);assert.equal(field(f.tree,'Порядок производства').props.value,'video-first');assert.equal(f.p.productionOrder,'voice-first');
    f.pending(undefined);await f.save();enabled(f);assert.equal(f.p.productionOrder,'video-first');
  });
  await test('failed brief save retains local changes and clean saved updates sync',async()=>{
    const f=fixture();f.addSource();await f.save();f.edit('Аудитория','Изменённая аудитория');const wait=deferred();f.pending(wait);
    const saving=f.save();wait.reject(Error('Local save failure'));await assert.rejects(saving,/Local save failure/);blocked(f);assert.equal(field(f.tree,'Аудитория').props.value,'Изменённая аудитория');
    f.pending(undefined);await f.save();enabled(f);f.update(p=>{p.directing.brief.audience='Восстановленная аудитория';p.productionOrder='video-first';});
    assert.equal(field(f.tree,'Аудитория').props.value,'Восстановленная аудитория');assert.equal(field(f.tree,'Порядок производства').props.value,'video-first');enabled(f);
  });
}finally{globalThis.fetch=originalFetch;}
console.log('PASS '+checks+' editor lifecycle regressions. No provider requests or real project writes.');
