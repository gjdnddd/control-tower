export const VERSION = 4;
export const REGISTRY_FILE = 'control_tower_registry_v4.json';
export const EVENT_PREFIX = 'ct4_event_';
export const ENTITIES = ['systems', 'issues', 'relations'];
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const validId = id => /^[a-zA-Z0-9_-]{1,100}$/.test(id || '') && !['__proto__','constructor','prototype'].includes(id);
export const clone = value => JSON.parse(JSON.stringify(value));
export const safeUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
export function validateBase(input) {
  if (!input || input.version !== VERSION || !input.systems || typeof input.systems !== 'object' || Array.isArray(input.systems)) throw new Error('지원하지 않는 자료 형식입니다. 기존 자료는 유지됩니다.');
  for (const entity of ENTITIES) {
    const collection = input[entity] ?? {};
    if (typeof collection !== 'object' || Array.isArray(collection)) throw new Error('자료 구조를 확인해 주세요: ' + entity);
    for (const [id, record] of Object.entries(collection)) {
      if (!validId(id) || !record || typeof record !== 'object' || record.id !== id) throw new Error('잘못된 항목 식별자입니다.');
      if (entity === 'systems' && (typeof record.name !== 'string' || !record.name.trim())) throw new Error('이름 없는 시스템이 있습니다.');
    }
  }
  return clone({...input, issues: input.issues || {}, relations: input.relations || {}});
}
export function validateEvent(event) {
  if (!event || event.version !== VERSION || !/^[a-zA-Z0-9_-]{1,140}$/.test(event.id || '') || !ENTITIES.includes(event.entity) || !validId(event.target) || !event.updates || typeof event.updates !== 'object' || Array.isArray(event.updates) || !Number.isFinite(Date.parse(event.at))) throw new Error('변경 기록의 형식이 올바르지 않습니다.');
  for (const key of Object.keys(event.updates)) if (['__proto__', 'constructor', 'prototype', 'id'].includes(key)) throw new Error('허용되지 않는 변경 필드입니다.');
  return clone(event);
}
export function materialize(rawBase, rawEvents = []) {
  const base = validateBase(rawBase);
  const unique = new Map(rawEvents.map(e => [e.id, validateEvent(e)]));
  const events = [...unique.values()].sort((a,b) => Date.parse(a.at)-Date.parse(b.at) || a.id.localeCompare(b.id));
  const conflicts = [];
  const resolved = new Set(events.flatMap(e => e.resolves || []));
  for (const event of events) {
    const collection = base[event.entity];
    const target = Object.hasOwn(collection,event.target) ? collection[event.target] : {id: event.target};
    let applied = false;
    for (const [field, value] of Object.entries(event.updates)) {
      const current = target[field] ?? null;
      const previous = event.before?.[field] ?? null;
      if (!equal(current, previous) && !equal(current, value)) {
        const id = `${event.id}:${field}`;
        if (!resolved.has(id)) conflicts.push({id,eventId:event.id,entity:event.entity,target:event.target,field,current:clone(current),incoming:clone(value),at:event.at});
        continue;
      }
      target[field] = clone(value);
      applied = true;
    }
    if (applied) { target.updatedAt = event.at; collection[event.target] = target; }
  }
  return {...base,events,conflicts};
}
export function makeEvent(state, entity, target, updates, actor, resolves = []) {
  if (!ENTITIES.includes(entity)) throw new Error('알 수 없는 자료 종류입니다.');
  const current = state[entity]?.[target] || {};
  const changed = Object.fromEntries(Object.entries(updates).filter(([key,value]) => !equal(current[key],value)));
  if (!Object.keys(changed).length && !resolves.length) return null;
  const latest = Math.max(0,...(state.events || []).map(e => Date.parse(e.at)));
  const at = new Date(Math.max(Date.now(),latest + 1)).toISOString();
  const id = `${Date.parse(at).toString(36)}_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;
  return validateEvent({version:VERSION,id,at,actor,entity,target,updates:changed,before:Object.fromEntries(Object.keys(changed).map(k => [k,current[k] ?? null])),resolves});
}
export function mergeEvents(...sets) { return [...new Map(sets.flat().map(e => [e.id,validateEvent(e)])).values()]; }
export function parseGist(gist, parseFile) {
  const file = gist.files?.[REGISTRY_FILE];
  if (!file) throw new Error('새 시스템 자료가 없습니다. 연결한 Gist ID를 확인해 주세요.');
  const base = validateBase(parseFile(file));
  const events = Object.entries(gist.files).filter(([name]) => name.startsWith(EVENT_PREFIX) && name.endsWith('.json')).map(([,file]) => validateEvent(parseFile(file)));
  return {base,events};
}
export function exportSnapshot(state) {
  const {systems,issues,relations,workflows,legacyMap,metadata,changeLog} = state;
  return {version:VERSION,exportedAt:new Date().toISOString(),systems,issues,relations,workflows,legacyMap,metadata,changeLog};
}
