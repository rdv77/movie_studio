import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

await build({stdin:{resolveDir:process.cwd(),contents:`export {parseDirectorJSON} from './lib/directing';export {scriptWorkflowResultSchema} from './lib/script-workflow';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/director-json-repair.mjs'});
const {parseDirectorJSON,scriptWorkflowResultSchema}=await import('../work/tests/director-json-repair.mjs');

// Sanitized extract of a returned provider answer: exactly one extra opening
// quote before emotionStart; no changes to the response's words or meaning.
const malformed='{"trigger":"Герой осторожно поднимает ладонь.","meaning":"Контакт установлен.",""emotionStart":"тёплый интерес","emotionEnd":"доверие","decision":"Улыбнуться.","visibleEvidence":"Мягкая улыбка."}';
assert.throws(()=>JSON.parse(malformed));
assert.deepEqual(parseDirectorJSON(malformed),{trigger:'Герой осторожно поднимает ладонь.',meaning:'Контакт установлен.',emotionStart:'тёплый интерес',emotionEnd:'доверие',decision:'Улыбнуться.',visibleEvidence:'Мягкая улыбка.'});
assert.deepEqual(parseDirectorJSON('```json\n'+malformed+'\n```'),parseDirectorJSON(malformed));

for(const valid of [{text:'Данные ,""emotionStart": внутри реплики не исправляются.',nested:{'':1,'"emotionStart':'значение'},array:['','"quoted"']},{emoji:'🙂',quote:'\\"',emotionalArcs:[]}]){
  const text=JSON.stringify(valid);assert.deepEqual(parseDirectorJSON(text),valid,'Valid JSON is returned without rewriting');
}
assert.deepEqual(parseDirectorJSON('{"text":"🙂",""key":"значение"}'),{text:'🙂',key:'значение'});
assert.deepEqual(parseDirectorJSON('{"a":[{""emotionStart":"тревога"},{""emotionEnd":"доверие"}]}'),{a:[{emotionStart:'тревога'},{emotionEnd:'доверие'}]});
assert.deepEqual(parseDirectorJSON('{"shots":[{"performance":{"objective":"🙂"}]}]}'),{shots:[{performance:{objective:'🙂'}}]},'A redundant mismatched closer at the closed tail is removed');
assert.deepEqual(parseDirectorJSON('{"shots":[{"performance":{"objective":"🙂"} ] } ] }'),{shots:[{performance:{objective:'🙂'}}]});
assert.deepEqual(parseDirectorJSON('{"key":"literal ]}]} inside a string"}'),{key:'literal ]}]} inside a string'});
for(const invalid of ['{"text":"незавершённая строка}', '[""value"]', '{""key":}', '{"key" "value"}', '{"a":1,}', '{""key":1,"tail":}', '{""a":1,""b":2,""c":3,""d":4,""e":5}', '{"a":1],"b":2}', '{"a":1', '{"a":1]]}', '{"a":1} garbage']){
  assert.throws(()=>parseDirectorJSON(invalid),SyntaxError,'No general JSON or semantic repair: '+invalid);
}
const tooLong='{"text":'+JSON.stringify('x'.repeat(200_000))+',""emotionStart":"тревога"}';
assert.throws(()=>parseDirectorJSON(tooLong),SyntaxError,'Repair is size bounded');
assert(!scriptWorkflowResultSchema.safeParse(parseDirectorJSON('{""unknown":"field"}')).success,'Syntax repair never bypasses the semantic schema');

// Optional private incident fixture, deliberately not stored in version control.
const incident='../work/emotion-films/film-a-current.json';
if(existsSync(incident)){
  const p=JSON.parse(readFileSync(incident,'utf8'));
  const job=p.jobs.find(j=>j.id==='f87ea4f7-9dd5-40cb-a78e-727fb6450b8f');
  if(job?.output?.text){
    const text=job.output.text,parsed=parseDirectorJSON(text);
    assert.deepEqual(parsed,JSON.parse(text.replace(',""emotionStart":',',"emotionStart":')));
    assert(scriptWorkflowResultSchema.safeParse(parsed).success,'Actual received arc uses the supported schema');
    console.log('PASS private incident: saved dramaturg response parses and validates after one syntax-only correction.');
  }
}
console.log('PASS bounded director JSON repair: parse first, quoted strings preserved, nested keys, UTF-16 text, four-fix/size bounds, malformed values rejected, schema still enforced. No API calls.');
