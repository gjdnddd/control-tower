import test from 'node:test';
import assert from 'node:assert/strict';
import {materialize,makeEvent,mergeEvents,safeUrl,validateBase,validateEvent,exportSnapshot} from '../data-core.js';
const base=()=>({version:4,systems:{seed:{id:'seed',name:'SEED',notes:'기존 메모',wiki:'사용법'},vr:{id:'vr',name:'VR',notes:'기준'}},issues:{},relations:{},metadata:{}});
const event=(id,target,updates,before,at='2026-11-14T10:00:00Z')=>({version:4,id,target,entity:'systems',updates,before,at,actor:'test'});
test('different systems edited on two devices are retained',()=>{
 const state=materialize(base(),[event('pc','seed',{notes:'PC 수정'},{notes:'기존 메모'}),event('phone','vr',{notes:'폰 수정'},{notes:'기준'})]);
 assert.equal(state.systems.seed.notes,'PC 수정');assert.equal(state.systems.vr.notes,'폰 수정');assert.equal(state.conflicts.length,0);
});
test('same system different fields merge',()=>{
 const state=materialize(base(),[event('a','seed',{notes:'메모 수정'},{notes:'기존 메모'}),event('b','seed',{wiki:'문서 수정'},{wiki:'사용법'})]);
 assert.equal(state.systems.seed.notes,'메모 수정');assert.equal(state.systems.seed.wiki,'문서 수정');assert.equal(state.conflicts.length,0);
});
test('same field disagreement is preserved as a conflict',()=>{
 const state=materialize(base(),[event('a','seed',{notes:'PC'},{notes:'기존 메모'}),event('b','seed',{notes:'폰'},{notes:'기존 메모'})]);
 assert.equal(state.systems.seed.notes,'PC');assert.equal(state.conflicts.length,1);assert.equal(state.conflicts[0].incoming,'폰');
 const resolution=makeEvent(state,'systems','seed',{notes:'폰'},'test',[state.conflicts[0].id]);
 const resolved=materialize(base(),[...state.events,resolution]);assert.equal(resolved.systems.seed.notes,'폰');assert.equal(resolved.conflicts.length,0);
});
test('keeping current value can explicitly resolve a conflict',()=>{
 const events=[event('a','seed',{notes:'PC'},{notes:'기존 메모'}),event('b','seed',{notes:'폰'},{notes:'기존 메모'})];const state=materialize(base(),events);
 const resolution=makeEvent(state,'systems','seed',{notes:'PC'},'test',[state.conflicts[0].id]);assert.ok(resolution);
 assert.equal(materialize(base(),[...events,resolution]).conflicts.length,0);
});
test('pending local change survives a delayed remote read',()=>{
 const local=event('local','seed',{notes:'새 로컬 메모'},{notes:'기존 메모'});
 const state=materialize(base(),mergeEvents([], [local]));assert.equal(state.systems.seed.notes,'새 로컬 메모');
});
test('idempotent retries do not repeat or conflict',()=>{
 const a=event('a','seed',{notes:'수정'},{notes:'기존 메모'});const state=materialize(base(),mergeEvents([a],[a],[a]));assert.equal(state.events.length,1);assert.equal(state.conflicts.length,0);
});
test('same intended result does not conflict',()=>{
 const state=materialize(base(),[event('a','seed',{notes:'같은 값'},{notes:'기존 메모'}),event('b','seed',{notes:'같은 값'},{notes:'기존 메모'})]);assert.equal(state.conflicts.length,0);
});
test('event order is deterministic across clients',()=>{
 const a=event('a','seed',{notes:'A'},{notes:'기존 메모'}),b=event('b','seed',{notes:'B'},{notes:'기존 메모'});
 assert.deepEqual(materialize(base(),[a,b]),materialize(base(),[b,a]));
});
test('bad data is rejected without mutating the source',()=>{
 const original=base();assert.throws(()=>validateBase({version:3,systems:{}}));assert.throws(()=>validateEvent({id:'x'}));assert.throws(()=>validateEvent(event('x','seed',JSON.parse('{"__proto__":{"polluted":true}}'),{})));assert.equal(original.systems.seed.notes,'기존 메모');
});
test('reserved target identifiers cannot alter object prototypes',()=>{
 for(const id of ['__proto__','constructor','prototype'])assert.throws(()=>validateEvent(event('bad',id,{notes:'x'},{})));
 assert.equal({}.notes,undefined);
});
test('unsafe URLs cannot become navigation links',()=>{
 assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('data:text/html,<b>x</b>'),null);assert.equal(safeUrl('file:///C:/a.bat'),null);assert.equal(safeUrl('https://example.com/'),'https://example.com/');
});
test('export does not carry authentication or event actors',()=>{
 const state=materialize(base(),[event('x','seed',{notes:'safe'},{notes:'기존 메모'})]);const exported=exportSnapshot(state);assert.equal(exported.systems.seed.notes,'safe');assert.equal('events' in exported,false);assert.equal('token' in exported,false);
});
test('new system can be added and archived without deleting its history',()=>{
 const created=event('a','new_system',{name:'새 앱',notes:'설명'},{},'2026-11-14T10:00:00Z');const archived=event('b','new_system',{archived:true},{archived:null},'2026-11-14T10:00:01Z');const state=materialize(base(),[created,archived]);assert.equal(state.systems.new_system.name,'새 앱');assert.equal(state.systems.new_system.archived,true);assert.equal(state.events.length,2);
});
