import {build} from 'esbuild';
import {strict as A} from 'node:assert';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToString} from 'react-dom/server';

const server=`
export const api=handler=>handler;
export const owner=async()=>{if(globalThis.cameraPolicyTestDenied)throw Error('Unauthorized');return 'test-owner'};
export const runtime={DB:{prepare(sql){return{bind(...values){return{async run(){globalThis.cameraPolicyTestWrites.push({sql,values});return{success:true}}}}}}}};
`;
await build({
  stdin:{resolveDir:process.cwd(),contents:`
    export * as C from './app/camera-policy-control';
    export * as N from './app/staging-policy-controls';
    export * as UI from './app/shot-direction-editor';
    export * as E from './app/directing-editor';
    export * as D from './lib/domain';
    export * as R from './lib/directing';
    export {POST} from './app/api/projects/route';
  `},
  bundle:true,platform:'node',format:'esm',outfile:'work/tests/camera-policy-ui.mjs',
  external:['react','react-dom','@ffmpeg/ffmpeg'],
  banner:{js:`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);`},
  plugins:[{name:'local-project-create',setup(b){
    b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'camera-policy-test'}));
    b.onLoad({filter:/.*/,namespace:'camera-policy-test'},()=>({contents:server}));
  }}],
});
const {C,N,UI,E,D,R,POST}=await import('../work/tests/camera-policy-ui.mjs');
let changes=0;
const onChange=()=>{changes++;throw Error('Rendering must never save or start generation');};
const html=(component,props)=>renderToString(React.createElement(component,props));

const legacy=html(C.CameraPolicyControl,{onChange});
A(legacy.includes('Работа камеры'));
A.match(legacy,/<option value="" selected="">/,'An old film must not silently inherit a new camera policy');
for(const value of ['static','cinematic','dynamic'])A.match(legacy,new RegExp(`<option value="${value}">`));
for(const label of ['Преимущественно статичная','Сдержанная кинематографическая','Динамичная'])A(legacy.includes(label),label);

const explicit=html(C.CameraPolicyControl,{value:'dynamic',name:'cameraPolicy',disabled:true,onChange});
A.match(explicit,/<option value="dynamic" selected="">/);
A.match(explicit,/<select[^>]*name="cameraPolicy"[^>]*disabled=""/);
const fresh=html(N.NewProjectPolicyFields,{});
A.match(fresh,/<select[^>]*name="cameraPolicy"/);
A.match(fresh,/<option value="cinematic" selected="">/,'A new film defaults to restrained cinematography');

const project=D.newProject('Существующий фильм'),directing=R.ensureDirecting(project);
delete directing.brief.cameraPolicy;
const before=structuredClone(project);
const brief=html(E.DirectingEditor,{p:project,stage:0,busy:false,submit:onChange,open:onChange});
A(brief.includes('Работа камеры'));
A.deepEqual(project,before,'Opening the creative brief does not migrate old data');
directing.brief.cameraPolicy='dynamic';
const current=structuredClone(project);
const detailed=html(E.DirectingEditor,{p:project,stage:4,busy:false,submit:onChange,open:onChange});
A(detailed.includes('Динамичная'),'The selected policy is visible next to detailed shot development');
A.deepEqual(project,current,'The detailed editor does not save during render');

const direction={
  framingStart:'medium',framingEnd:'close-up',
  cameraMovement:{type:'push-in',description:'Плавный наезд по прямой',from:'Средний план у берега',to:'Крупный план лица',
    purpose:'Показать переход от тревоги к любопытству',speed:'Медленно и равномерно',start:0,end:4,keepInFrame:'Глаза героя в верхней трети'},
};
const original=structuredClone(direction);
const editor=html(UI.ShotDirectionEditor,{direction,duration:5,disabled:true,onChange});
A(editor.includes('<fieldset disabled=""'));
for(const label of ['Зачем движется камера','Скорость и характер движения','Начало движения камеры, сек','Конец движения камеры, сек','Что удерживать в кадре'])A(editor.includes(label),label);
for(const value of ['Показать переход от тревоги к любопытству','Медленно и равномерно','Глаза героя в верхней трети'])A(editor.includes(value),value);
A.match(editor,/value="0"/,'Movement starting at zero must stay visible');
A.match(editor,/value="4"/);
const summary=html(UI.ShotDirectionSummary,{direction,duration:5});
for(const value of ['Показать переход от тревоги к любопытству','Медленно и равномерно','Глаза героя в верхней трети'])A(summary.includes(value),value);
A.deepEqual(direction,original);
const edited=UI.patchShotDirection(direction,{cameraMovement:{...direction.cameraMovement,end:4.5}});
A.equal(edited.cameraMovement.end,4.5);
A.equal(edited.cameraMovement.purpose,original.cameraMovement.purpose);
edited.cameraMovement.description='Правка только локальной копии';
A.deepEqual(direction,original,'Camera edits must not mutate the saved plan');
A.equal(UI.patchShotDirection(undefined,{}),undefined);
const invalidTime={...direction,cameraMovement:{...direction.cameraMovement,start:-1}};
A(UI.directionEditorIssues(invalidTime,5).some(i=>i.message==='Время должно быть числом от 0 до 60 секунд.'));
const tooLong={...direction,cameraMovement:{...direction.cameraMovement,end:6}};
A(UI.directionEditorIssues(tooLong,5).some(i=>i.code==='camera_fit'));
const reversed={...direction,cameraMovement:{...direction.cameraMovement,start:4,end:3}};
A(UI.directionEditorIssues(reversed,5).some(i=>i.code==='camera_order'));
A.equal(changes,0,'SSR must not send edits, approvals or generations');

// The form must include the selected policy in the actual project-create request.
const app=await readFile('app/studio.tsx','utf8');
A.match(app,/request\('\/api\/projects',\s*'POST',\s*\{[^}]*cameraPolicy[^}]*\}\)/);
A.match(app,/get\(['"]cameraPolicy['"]\)/);

// Exercise the real create route with local in-memory storage only.
globalThis.cameraPolicyTestWrites=[];
const create=body=>POST(new Request('http://localhost/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
let response=await create({title:'Новый фильм'});
A.equal(response.status,201);
let created=await response.json();
A.equal(created.directing.brief.cameraPolicy,'cinematic');
A.equal(JSON.parse(globalThis.cameraPolicyTestWrites[0].values[3]).directing.brief.cameraPolicy,'cinematic');
for(const cameraPolicy of ['static','cinematic','dynamic']){
  response=await create({title:'Выбранная политика',cameraPolicy});
  created=await response.json();
  A.equal(created.directing.brief.cameraPolicy,cameraPolicy);
}
const count=globalThis.cameraPolicyTestWrites.length;
await A.rejects(()=>create({title:'Некорректная политика',cameraPolicy:'cinematic-ish'}));
A.equal(globalThis.cameraPolicyTestWrites.length,count,'Invalid policies cannot be written');
globalThis.cameraPolicyTestDenied=true;
await A.rejects(()=>create({title:'Без доступа'}),/Unauthorized/);
A.equal(globalThis.cameraPolicyTestWrites.length,count,'Unauthorized calls cannot create a film');
delete globalThis.cameraPolicyTestDenied;
delete globalThis.cameraPolicyTestWrites;
console.log('PASS camera UI: explicit new defaults, unchanged legacy films, visible/editable camera task, immutable edits, zero timing, actual project-create policy validation; no remote or paid calls.');
