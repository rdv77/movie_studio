import {build} from 'esbuild';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export {AnimaticTimeline} from './app/animatic-timeline';export * as D from './lib/domain';export * as K from './lib/keyframes';export * as A from './lib/animatic';export * as M from './lib/animatic-manifest';export {editPlan} from './lib/render';`},bundle:true,jsx:'automatic',platform:'node',format:'esm',packages:'external',outfile:'work/tests/animatic-timeline-view.mjs'});
const {AnimaticTimeline,D,K,A,M,editPlan}=await import('../work/tests/animatic-timeline-view.mjs');
const p=D.newProject('Проверка сохранённого просмотра');p.animaticSettings={sound:'silent'};
const shots=[{id:'shot-1',title:'План 01 — Общий',duration:5,direction:{framingStart:'wide',framingEnd:'wide',timing:{endingHold:.8}}},{id:'shot-2',title:'План 02 — Крупный',duration:3,direction:{framingStart:'close-up',framingEnd:'close-up',timing:{endingHold:.5}}}];
for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{kind:'text',text:stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
const script=p.items.find(i=>i.stage===4),one=p.items.find(i=>i.stage===5),two={id:D.id(),stage:5,title:shots[1].title,variants:[]};p.items.push(two);
for(const [index,item] of [one,two].entries()){
 const shot=shots[index];item.title=shot.title;item.sourceShot={scriptId:script.id,shotId:shot.id,title:shot.title};
 const start=D.makeVariant(p,item,{kind:'image',assetId:`start-${index+1}`,duration:shot.duration,model:'grok-imagine-image-2.0'});item.variants.push(start);item.selectedId=start.id;K.setKeyframeMode(p,item.id,'pair');
 const end=D.makeVariant(p,item,{...K.prepareKeyframeGeneration(p,item.id,'end',{model:start.model}),kind:'image',assetId:`end-${index+1}`,duration:shot.duration});item.variants.push(end);K.chooseKeyframe(p,item.id,'end',end.id);D.approve(p,item.id);
}
const save=title=>{const basis=A.animaticBasis(p),plan=editPlan(p,true);return A.saveAnimatic(p,{kind:'video',assetId:D.id(),title,animaticManifest:M.buildAnimaticManifest(p,plan,basis)},basis);};
const first=save('Просмотр до замены'),frozen=structuredClone(p);
const render=()=>renderToStaticMarkup(React.createElement(AnimaticTimeline,{p,busy:false,save:async()=>{throw Error('Unexpected write');},jump:()=>{throw Error('Unexpected navigation');}}));
const article=(html,title)=>html.match(new RegExp(`<article[^>]*aria-label="Сохранённый план · ${title}"[\\s\\S]*?</article>`))?.[0]??'';
let html=render();assert.deepEqual(p,frozen,'Reading the view never mutates choices, approvals or the saved film');
assert(!html.includes('Сохранённый аниматик устарел'));
const a=article(html,one.title),b=article(html,two.title);
assert(a.includes('/api/assets/start-1')&&a.includes('/api/assets/end-1')&&!a.includes('/api/assets/start-2'));
assert(b.includes('/api/assets/start-2')&&b.includes('/api/assets/end-2')&&!b.includes('/api/assets/start-1'));
assert(a.includes('0.00–5.00 сек фильма · длительность 5.00 сек'));
assert(a.includes('Показ: 0.00–4.21 сек фильма')&&a.includes('Показ: 4.21–5.00 сек фильма'));
assert(b.includes('5.00–8.00 сек фильма · длительность 3.00 сек'));
assert(b.includes('Показ: 5.00–7.50 сек фильма')&&b.includes('Показ: 7.50–8.00 сек фильма'));
assert(b.includes('Длительность показа: 0.50 сек'));
// A newly approved ending must flag the historical image, not silently replace the saved MP4's source.
const next={...two.variants.at(-1),id:D.id(),assetId:'new-end-2'};two.variants.push(next);K.chooseKeyframe(p,two.id,'end',next.id);D.approve(p,two.id);
html=render();assert(html.includes('Сохранённый аниматик устарел'));assert(article(html,two.title).includes('В раскадровке выбран другой вариант'));assert(!article(html,one.title).includes('В раскадровке выбран другой вариант'));assert(html.includes('/api/assets/end-2')&&!html.includes('/api/assets/new-end-2'));
assert.equal(first.animaticManifest.clips[1].frames[1].assetId,'end-2');
const rebuilt=save('Просмотр после замены');html=render();assert(html.includes('/api/assets/new-end-2'));assert(!html.includes('Сохранённый аниматик устарел'));assert(!html.includes('В раскадровке выбран другой вариант'));
// Reordering and removal match stable plan IDs; saved frames and times stay with their own plan.
const x=p.items.indexOf(one),y=p.items.indexOf(two);[p.items[x],p.items[y]]=[p.items[y],p.items[x]];
html=render();assert(article(html,one.title).includes('под номером 2'));assert(article(html,two.title).includes('под номером 1'));assert(!html.includes('В раскадровке выбран другой вариант'));
one.removedAt=D.now();html=render();assert(article(html,one.title).includes('больше не участвует'));assert(article(html,one.title).includes('<button type="button" disabled=""'));assert(article(html,two.title).includes('/api/assets/new-end-2'));
assert.equal(rebuilt.animaticManifest.clips[0].itemId,one.id);
p.animatic.selectedId=first.id;html=render();assert(html.includes('Просмотр до замены'));assert(html.includes('/api/assets/end-2')&&!html.includes('/api/assets/new-end-2'));
delete first.animaticManifest;html=render();assert(html.includes('Соберите новый аниматик, чтобы сохранить его кадры и таймлайн'));
console.log('PASS animatic timeline: two plans retain their own images and film intervals; stale ending localized, saved sources immutable, rebuilt selection current, stable IDs after reorder/removal, legacy fallback. No paid calls.');
