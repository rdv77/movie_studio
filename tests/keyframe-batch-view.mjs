import {build} from 'esbuild';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export {KeyframeBatchEditor} from './app/keyframe-batch-editor';export * as D from './lib/domain';export * as K from './lib/keyframes';`},bundle:true,jsx:'automatic',platform:'node',format:'esm',packages:'external',outfile:'work/tests/keyframe-batch-view.mjs',plugins:[{name:'count-compiles',setup(b){
 b.onResolve({filter:/^@\/lib\/prompt-compiler$/},()=>({path:'compiler',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export function compilePrompt(){globalThis.compilations++;return {references:[]}}`}));
}}]});
const {KeyframeBatchEditor,D,K}=await import('../work/tests/keyframe-batch-view.mjs');
const p=D.newProject('Ленивая массовая генерация');
for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{kind:'text',text:'Основа'});D.approve(p,i.id);}
const item=p.items.find(i=>i.stage===5);K.setKeyframeMode(p,item.id,'pair');
const first=D.makeVariant(p,item,{kind:'image',assetId:D.id(),model:'grok-imagine-image-2.0',jobId:D.id()});item.variants.push(first);item.selectedId=first.id;
const props={p,busy:false,submit:async()=>{throw Error('Unexpected generation')}};
globalThis.compilations=0;
let html=renderToStaticMarkup(React.createElement(KeyframeBatchEditor,props));
assert.equal(compilations,0,'Closed panel does not compile any film prompts');assert(html.includes('Ключевые кадры · массовая генерация'));
html=renderToStaticMarkup(React.createElement(KeyframeBatchEditor,{...props,initiallyOpen:true}));
assert.equal(compilations,1,'Opening prepares the plan and estimate');assert(html.includes('Создать ключевые кадры'));assert(html.includes('checked=""'),'Missing eligible frames remain selected on initial open');
console.log('PASS keyframe batch view: closed panel skips compilation; opened panel prepares eligible selected frames. No paid calls.');
