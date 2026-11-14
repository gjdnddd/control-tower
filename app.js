import {VERSION,REGISTRY_FILE,EVENT_PREFIX,validateBase,validateEvent,materialize,makeEvent,mergeEvents,exportSnapshot,safeUrl,clone} from './data-core.js';
import {demoBase} from './demo-data.js';

const $ = selector => document.querySelector(selector);
const storage = {
 get(key,fallback=null){try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}},
 set(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('기기 저장 공간이 부족합니다. 자료를 내보내 주세요.',true);return false;}}
};
function el(tag,props={},...children){
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(props)){
  if(value===undefined||value===null)continue;
  if(key==='class')node.className=value;
  else if(key==='text')node.textContent=value;
  else if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
  else if(['value','checked','disabled','selected'].includes(key))node[key]=value;
  else node.setAttribute(key,String(value));
 }
 for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(typeof child==='string'||typeof child==='number'?document.createTextNode(String(child)):child);
 return node;
}
const button=(label,action,classes='btn',props={})=>el('button',{type:'button',class:classes,onClick:action,...props},label);
const formatDate=value=>value?new Date(value).toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}):'미확인';
const formatTime=value=>value?new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}):'';
const pretty=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const config=()=>({id:localStorage.getItem('ct_gist_id')||'',token:localStorage.getItem('ct_gist_token')||''});
const actor=localStorage.getItem('ct4_actor')||crypto.randomUUID();localStorage.setItem('ct4_actor',actor);
let base=demoBase,remoteEvents=[],pending=storage.get('ct4_pending',[]),state=materialize(demoBase),syncState='disconnected',syncMessage='',lastSync='',syncing=false,flushing=false,toastTimer;
let view='overview',search='',filters={domain:'',kind:'',usage:'',check:'',favorites:false,archived:false},layout=storage.get('ct4_layout','table');
let favorites=storage.get('ct4_favorites',['seed','invest_dashboard','indicator_api']),flow='',detailTab='overview',activeId=null,connected=false,remoteReadSucceeded=false,localStoreWarning='';
const cached=storage.get('ct4_cache');
if(cached){try{base=validateBase(cached.base);remoteEvents=(cached.events||[]).map(validateEvent);pending=pending.map(validateEvent);connected=!base.metadata?.demo;state=materialize(base,mergeEvents(remoteEvents,pending));}catch{localStoreWarning='기기 캐시를 읽지 못했습니다. 원격 자료를 다시 불러오거나 보관한 JSON을 확인해 주세요.';}}
function toast(message,error=false){const node=$('#toast');node.textContent=message;node.className='visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.className='',4500);}
function cache(){storage.set('ct4_cache',{base,events:remoteEvents});storage.set('ct4_pending',pending);}
function recompute(){state=materialize(base,mergeEvents(remoteEvents,pending));cache();}
const systems=()=>Object.values(state.systems).filter(s=>s.name);
const visibleSystems=()=>systems().filter(s=>!!s.archived===!!filters.archived);
const openIssues=()=>Object.values(state.issues).filter(i=>!i.archived&&i.status!=='완료');
const changes=()=>[...(state.events||[]).map(e=>({id:e.id,at:e.at,systemId:e.entity==='systems'?e.target:state[e.entity]?.[e.target]?.systemId,title:`${state[e.entity]?.[e.target]?.name||state[e.entity]?.[e.target]?.title||'항목'} · ${Object.keys(e.updates).map(fieldName).join(', ')} 변경`,source:'직접 편집'})),...(state.changeLog||[])].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
const FIELD_NAMES={name:'이름',purpose:'목적',domain:'분야',kind:'유형',usageStatus:'사용 상태',checkStatus:'점검 상태',localPath:'위치',url:'접속 주소',nextAction:'다음 조치',notes:'메모',wiki:'사용법',status:'처리 상태',priority:'우선순위',title:'제목',detail:'내용',archived:'보관 상태',label:'관계 설명',confidence:'확인 수준',from:'연결 시작',to:'연결 대상',workflow:'작업 흐름'};
function fieldName(key){return FIELD_NAMES[key]||key;}
function badge(text){const style=['사용 중','정상 확인','완료','확인'].includes(text)?'good':['개발 중','진행 중','계획','문제 있음'].includes(text)?'warn':['높음','종료'].includes(text)?'bad':text==='문서'?'violet':'neutral';return el('span',{class:'badge '+style},text||'미확정');}
function star(id){return button(favorites.includes(id)?'★':'☆',()=>{favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];storage.set('ct4_favorites',favorites);render();if(activeId)openDetail(activeId,detailTab);},'icon-button'+(favorites.includes(id)?' selected':''),{'aria-label':favorites.includes(id)?'즐겨찾기 해제':'즐겨찾기 추가',title:'즐겨찾기'});}
function guardEdit(){if(base.metadata?.demo){openSettings('기존 자료를 편집하려면 Gist를 먼저 연결해 주세요.');return false;}return true;}
function mutate(entity,target,updates,resolves=[],expected=null){
 if(!guardEdit())return false;
 const event=makeEvent(state,entity,target,updates,actor,resolves);
 if(!event){toast('변경된 내용이 없습니다.');return true;}
 if(expected)for(const key of Object.keys(event.updates))event.before[key]=expected[key]??null;
 pending=mergeEvents(pending,[event]);recompute();syncMessage='변경 내용을 이 기기에 보관했습니다.';render();
 if(config().id&&config().token)void flush();else toast('이 기기에 저장했습니다. Gist를 연결하면 전송합니다.');
 return true;
}
async function api(url,options={}){
 const cfg=config();
 const res=await fetch(url,{cache:'no-store',...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${cfg.token}`,...options.headers}});
 if(!res.ok){const reset=res.headers.get('x-ratelimit-reset');throw new Error(res.status===401?'토큰을 확인해 주세요 (401).':res.status===403?'접근 권한 또는 요청 제한을 확인해 주세요 (403).'+(reset?' 잠시 후 다시 시도하세요.':''):`GitHub 응답 오류 (${res.status})`);}
 return res;
}
async function readFile(file){
 if(file.truncated||typeof file.content!=='string'){
  const url=new URL(file.raw_url||'');
  if(url.hostname!=='gist.githubusercontent.com')throw new Error('허용되지 않는 원격 파일 주소입니다.');
  return JSON.parse(await(await api(url.href)).text());
 }
 return JSON.parse(file.content);
}
async function sync({silent=false}={}){
 const cfg=config();if(!cfg.id||!cfg.token){if(!silent)openSettings();return false;}if(syncing)return false;
 syncing=true;syncState='loading';updateSync();
 try{
  const gist=await(await api(`https://api.github.com/gists/${encodeURIComponent(cfg.id)}`)).json();
  if(!gist.files?.[REGISTRY_FILE])throw new Error('새 관리 자료가 없는 Gist입니다. 연결 ID를 확인해 주세요.');
  const nextBase=validateBase(await readFile(gist.files[REGISTRY_FILE]));
  const files=Object.entries(gist.files).filter(([n])=>n.startsWith(EVENT_PREFIX)&&n.endsWith('.json'));
  const nextEvents=[];
  for(const [,file] of files)nextEvents.push(validateEvent(await readFile(file)));
  // Pending edits survive every load, including a slow initial request.
  base=nextBase;remoteEvents=mergeEvents(remoteEvents,nextEvents);connected=true;remoteReadSucceeded=true;recompute();lastSync=new Date().toISOString();syncState='ok';syncMessage='최신 자료를 불러왔습니다.';
  render();if(activeId&&$('#dialog').open)openDetail(activeId,detailTab);
  if(!silent)toast(pending.length?'불러왔습니다. 기기에 보관된 변경을 이어서 전송합니다.':'최신 자료를 불러왔습니다.');
  return true;
 }catch(error){syncState='error';syncMessage=error.message;render();if(!silent)toast(error.message,true);return false;}
 finally{syncing=false;updateSync();}
}
async function flush(){
 const cfg=config();if(flushing||!cfg.id||!cfg.token||!pending.length)return;
 flushing=true;
 try{
  if(!remoteReadSucceeded){const loaded=await sync({silent:true});if(!loaded)return;}
  while(pending.length){
   const batch=pending.slice(0,12);
   // Each edit has an immutable, unique file: no client replaces another's catalog.
   const files=Object.fromEntries(batch.map(event=>[`${EVENT_PREFIX}${event.id}.json`,{content:JSON.stringify(event)}]));
   syncState='saving';updateSync();
   await api(`https://api.github.com/gists/${encodeURIComponent(cfg.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({files})});
   const sent=new Set(batch.map(e=>e.id));remoteEvents=mergeEvents(remoteEvents,batch);pending=pending.filter(e=>!sent.has(e.id));recompute();lastSync=new Date().toISOString();
  }
  syncState='ok';syncMessage='변경 기록을 저장했습니다.';await sync({silent:true});
 }catch(error){syncState='error';syncMessage=error.message+' 변경은 이 기기에 남아 있습니다.';toast(syncMessage,true);}
 finally{flushing=false;render();}
}
async function refresh(){await sync();if(pending.length)await flush();}
function updateSync(){
 const node=$('#sync-status');if(!node)return;
 const label=syncState==='loading'?'불러오는 중':syncState==='saving'?'저장 중':syncState==='error'?'연결 확인':pending.length?`미전송 ${pending.length}`:syncState==='ok'?`${formatTime(lastSync)} 동기화`:connected?'기기 저장본':'Gist 연결';
 node.replaceChildren(el('span',{class:'dot '+(syncState==='error'?'error':pending.length?'pending':syncState==='ok'?'ok':'')}),el('span',{},label));node.title=syncMessage||'Gist 연결 설정';
}
function pageHeading(title,description,actions=[]){return el('div',{class:'page-heading'},el('div',{},el('div',{class:'eyebrow'},'MY SYSTEMS / CONTROL TOWER'),el('h1',{},title),el('p',{class:'subtitle'},description)),el('div',{class:'actions'},actions));}
const navItems=[['overview','◫','전체 현황'],['systems','▦','시스템 목록'],['wiki','▤','사용법 위키'],['relations','⌘','연결 관계'],['issues','◷','점검 · 다음 조치'],['changes','↻','변경 기록']];
function navigate(next){view=next;activeId=null;$('#dialog').close();document.body.classList.remove('mobile-nav');history.replaceState(null,'',`#${next}`);render();window.scrollTo({top:0,behavior:'instant'});}
function render(){
 const currentSearch=$('#global-query');const focused=currentSearch===document.activeElement;const cursor=focused?currentSearch.selectionStart:null;
 const nav=el('nav',{'aria-label':'주 메뉴'},navItems.map(([key,symbol,label])=>button([el('span',{class:'nav-symbol','aria-hidden':'true'},symbol),el('span',{},label),key==='systems'?el('span',{class:'nav-count'},systems().filter(s=>!s.archived).length):key==='issues'&&openIssues().length?el('span',{class:'nav-count'},openIssues().length):null],()=>navigate(key),'nav-item'+(view===key?' active':''),{'aria-current':view===key?'page':null,'aria-label':label})));
 const sidebar=el('aside',{class:'sidebar'},el('div',{class:'brand'},el('span',{class:'brandmark','aria-hidden':'true'},'⌂'),el('div',{},el('strong',{},'CONTROL TOWER'),el('small',{},'내 시스템 운영지도'))),el('p',{class:'nav-label'},'WORKSPACE'),nav,el('div',{class:'sidebar-bottom'},el('a',{class:'sidebar-link',href:'https://gjdnddd.github.io/HQ/',target:'_blank',rel:'noopener noreferrer'},'↗','HQ 홈으로'),button(['⚙','연결 · 자료 관리'],()=>openSettings(),'sidebar-link'),el('div',{class:'sidebar-foot'},'한곳에서 파악하고, 필요한 곳으로.',' · v4.0')));
 const input=el('input',{id:'global-query',type:'search',placeholder:'시스템·사용법·메모 검색',value:search,'aria-label':'전체 검색',onInput:event=>{search=event.target.value;if(!['systems','wiki','issues'].includes(view))view='systems';render();}});
 const topbar=el('header',{class:'topbar'},button('☰',()=>document.body.classList.toggle('mobile-nav'),'menu-button',{'aria-label':'메뉴 열기'}),el('div',{class:'breadcrumb'},'나의 운영 공간',el('span',{},'  /  '),el('b',{},navItems.find(n=>n[0]===view)?.[2]||'전체 현황')),el('div',{class:'top-actions'},el('label',{class:'global-search'},el('span',{'aria-hidden':'true'},'⌕'),input,el('kbd',{},'Ctrl K')),button('',()=>openSettings(),'sync-button',{id:'sync-status','aria-label':'연결 및 동기화 상태'})));
 const content=el('main',{class:'content',id:'main',tabindex:'-1'});
 if(base.metadata?.demo)content.append(el('div',{class:'notice'},el('span',{},'연결 전 안내 목록입니다. Gist를 연결하면 기존 메모와 전체 검토 자료를 불러옵니다.'),button('기존 Gist 연결',()=>openSettings(),'btn compact')));
 if(localStoreWarning)content.append(el('div',{class:'notice error'},localStoreWarning));
 if(syncState==='error')content.append(el('div',{class:'notice error'},el('span',{},syncMessage),button('다시 연결',refresh,'btn compact')));
 if(state.conflicts.length)content.append(el('div',{class:'notice error'},el('span',{},`다른 기기의 수정과 겹치는 항목 ${state.conflicts.length}개가 있습니다. 두 내용을 보존했습니다.`),button('내용 비교',showConflicts,'btn compact')));
 if(pending.length&&syncState!=='error')content.append(el('div',{class:'notice info'},el('span',{},`기기에 보관된 변경 ${pending.length}개 · 연결되면 순서대로 전송합니다.`),button('지금 동기화',refresh,'btn compact')));
 ({overview:renderOverview,systems:renderSystems,wiki:renderWiki,relations:renderRelations,issues:renderIssues,changes:renderChanges}[view]||renderOverview)(content);
 content.append(el('p',{class:'footer-note'},base.metadata?.demo?'공개 안내 목록 · 실제 운영 상태는 연결 후 확인하세요.':`점검 기준 ${state.metadata?.checkedAt||'미확인'} · 상태와 사용법은 기록된 점검 범위에 따른 자료입니다. 실시간 서버 감시 결과와 구분해 보세요.`));
 $('#app').replaceChildren(sidebar,button('',()=>document.body.classList.remove('mobile-nav'),'mobile-overlay',{'aria-label':'메뉴 닫기'}),el('div',{class:'app-main'},topbar,content));updateSync();
 if(focused){$('#global-query').focus();$('#global-query').setSelectionRange?.(cursor,cursor);}
}
function renderOverview(host){
 const all=systems().filter(s=>!s.archived),issues=openIssues();
 host.append(pageHeading('내 시스템, 한눈에.', '무엇이 있고, 어떻게 연결되며, 다음에 무엇을 해야 하는지.',[button('↻ 새로고침',refresh,'btn'),button('+ 시스템 등록',()=>editSystem(),'btn primary')]));
 host.append(el('section',{class:'hero'},el('div',{},el('div',{class:'eyebrow'},'YOUR PERSONAL OPERATING MAP'),el('h2',{},'흩어진 시스템을 하나의 지도로.'),el('p',{},'프로그램의 목적과 사용법부터 자료의 흐름, 남아 있는 점검까지. 필요한 정보를 찾고 다음 행동으로 이어가세요.'),el('div',{class:'actions'},button('전체 시스템 살펴보기 →',()=>navigate('systems'),'btn primary'),button('연결 관계 보기',()=>navigate('relations'),'btn quiet'))),el('div',{class:'hero-art','aria-hidden':'true'},'⌘')));
 const metrics=[['전체 시스템',all.length,'프로그램·자동화·문서','▦',()=>navigate('systems')],['사용 중',all.filter(s=>s.usageStatus==='사용 중').length,'사용 상태 기준','◉',()=>{filters.usage='사용 중';navigate('systems');}],['확인할 문제',issues.length,'미완료 점검과 다음 조치','◷',()=>navigate('issues')],['사용법 문서',all.filter(s=>s.wiki).length,'시스템별 실행·문제 해결','▤',()=>navigate('wiki')]];
 host.append(el('section',{class:'metrics','aria-label':'현황 요약'},metrics.map(([label,value,note,mark,action])=>button([el('div',{class:'metric-label'},label),el('div',{class:'metric-value'},value),el('div',{class:'metric-note'},note),el('span',{class:'metric-mark','aria-hidden':'true'},mark)],action,'metric'))));
 const issuePanel=el('section',{class:'panel'},el('div',{class:'panel-head'},el('h2',{},'먼저 확인할 것'),button('전체 보기 →',()=>navigate('issues'),'text-link')));
 const sorted=issues.sort((a,b)=>(a.priority==='높음'?0:1)-(b.priority==='높음'?0:1));
 for(const issue of sorted.slice(0,5))issuePanel.append(issueRow(issue));if(!issues.length)issuePanel.append(empty('확인할 문제가 없습니다.','새 점검 결과가 생기면 여기에 모입니다.'));
 const favoritePanel=el('section',{class:'panel'},el('div',{class:'panel-head'},el('h2',{},'자주 찾는 시스템'),button('편집 →',()=>{filters.favorites=true;navigate('systems');},'text-link')));
 for(const id of favorites){const system=state.systems[id];if(!system||system.archived)continue;favoritePanel.append(button([el('span',{class:'favorite-mark'},system.name.slice(0,2)),el('div',{class:'favorite-copy'},el('strong',{},system.name),el('small',{},system.purpose)),el('span',{class:'chevron'},'↗')],()=>openDetail(id),'favorite-item'));}
 if(!favorites.some(id=>state.systems[id]))favoritePanel.append(empty('즐겨찾기를 골라보세요.','목록의 ☆ 버튼으로 추가할 수 있습니다.'));
 host.append(el('div',{class:'dashboard-grid'},issuePanel,favoritePanel));
 const recent=el('section',{class:'panel section-space'},el('div',{class:'panel-head'},el('h2',{},'최근 변경'),button('기록 보기 →',()=>navigate('changes'),'text-link')));
 for(const change of changes().slice(0,4))recent.append(el('div',{class:'change-item'},el('time',{},formatDate(change.at)),el('p',{},change.title),badge(change.source||'검토 기록')));
 if(!changes().length)recent.append(empty('변경 기록을 모아볼 수 있습니다.','자료를 연결하면 검토와 수정 이력이 표시됩니다.'));host.append(recent);
 host.append(el('div',{class:'connection-strip'},el('div',{},el('h3',{},'자료가 어디에서 어디로 가는지'),el('p',{},'수집 → 처리 → 활용 흐름을 따라 시스템을 이해해 보세요.')),button('관계도 살펴보기 →',()=>navigate('relations'),'btn')));
}
function empty(title,description=''){return el('div',{class:'empty'},el('strong',{},title),el('p',{},description));}
function issueRow(issue){return button([el('span',{class:'issue-indicator'+(issue.priority==='높음'?' high':'')}),el('div',{class:'issue-copy'},el('strong',{},issue.title),el('p',{},`${state.systems[issue.systemId]?.name||'공통'} · ${issue.status||'미처리'} · ${issue.priority||'보통'}`)),el('span',{class:'chevron'},'→')],()=>openIssue(issue.id),'issue-item');}
function optionSelect(label,value,choices,onChange){return el('select',{'aria-label':label,onChange:event=>onChange(event.target.value)},el('option',{value:'',selected:!value},label),choices.map(choice=>el('option',{value:choice,selected:choice===value},choice)));}
function matchingSystems(){const q=search.trim().toLowerCase();return visibleSystems().filter(s=>(!filters.domain||s.domain===filters.domain)&&(!filters.kind||s.kind===filters.kind)&&(!filters.usage||s.usageStatus===filters.usage)&&(!filters.check||s.checkStatus===filters.check)&&(!filters.favorites||favorites.includes(s.id))&&(!q||[s.name,s.folderName,s.purpose,s.notes,s.wiki,...(s.aliases||[])].join(' ').toLowerCase().includes(q)));}
function renderSystems(host){
 host.append(pageHeading('시스템 목록','실행 방법과 자료 위치를 찾고, 사용·점검 상태를 따로 관리합니다.',[button('↓ 자료 내보내기',exportData),button('+ 시스템 등록',()=>editSystem(),'btn primary')]));
 const unique=field=>[...new Set(systems().map(s=>s[field]).filter(Boolean))].sort();
 const filter=el('div',{class:'filters'},optionSelect('모든 분야',filters.domain,unique('domain'),value=>{filters.domain=value;render();}),optionSelect('모든 유형',filters.kind,unique('kind'),value=>{filters.kind=value;render();}),optionSelect('사용 상태',filters.usage,['사용 중','개발 중','보류','종료','미확정'],value=>{filters.usage=value;render();}),optionSelect('점검 상태',filters.check,['정상 확인','문제 있음','미확인'],value=>{filters.check=value;render();}),button('☆ 즐겨찾기',()=>{filters.favorites=!filters.favorites;render();},'filter-chip'+(filters.favorites?' active':'')),button('보관함',()=>{filters.archived=!filters.archived;render();},'filter-chip'+(filters.archived?' active':'')));
 host.append(el('div',{class:'section-toolbar'},filter,el('div',{class:'actions'},button('☷ 목록',()=>{layout='table';storage.set('ct4_layout',layout);render();},'filter-chip'+(layout==='table'?' active':'')),button('▦ 카드',()=>{layout='grid';storage.set('ct4_layout',layout);render();},'filter-chip'+(layout==='grid'?' active':'')))));
 const rows=matchingSystems();host.append(el('p',{class:'result-count'},`${rows.length}개 시스템${search?' · “'+search+'” 검색 결과':''}`));
 if(!rows.length){host.append(empty('조건에 맞는 시스템이 없습니다.','검색어 또는 필터를 바꿔보세요.'),button('필터 초기화',()=>{filters={domain:'',kind:'',usage:'',check:'',favorites:false,archived:false};search='';render();}));return;}
 if(layout==='grid')host.append(el('div',{class:'system-grid'},rows.map(s=>el('article',{class:'system-card'},el('div',{class:'card-top'},el('h3',{},button(s.name,()=>openDetail(s.id),'system-name')),star(s.id)),el('p',{},s.purpose),el('div',{class:'card-bottom'},badge(s.domain),badge(s.kind),badge(s.usageStatus),badge(s.checkStatus)),button('상세 · 사용법 →',()=>openDetail(s.id),'text-link')))));
 else{
  const body=el('tbody',{},rows.map(s=>el('tr',{},el('td',{},star(s.id)),el('td',{},button(s.name,()=>openDetail(s.id),'system-name'),el('p',{class:'system-purpose'},s.purpose)),el('td',{},s.domain),el('td',{},badge(s.kind)),el('td',{},badge(s.usageStatus)),el('td',{},badge(s.checkStatus)),el('td',{},button('상세 →',()=>openDetail(s.id),'text-link')))));
  host.append(el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},['즐겨찾기','시스템 · 목적','분야','유형','사용 상태','점검 상태','자세히'].map(x=>el('th',{scope:'col'},x)))),body)));
 }
}
function renderWiki(host){
 host.append(pageHeading('사용법 위키','설치부터 실행·종료·문제 해결까지, 시스템별 설명을 연결합니다.'));
 const q=search.toLowerCase();const docs=systems().filter(s=>!s.archived&&s.wiki&&(!q||[s.name,s.wiki,s.notes].join(' ').toLowerCase().includes(q)));
 host.append(el('p',{class:'result-count'},`${docs.length}개 사용법 · 제목과 본문 검색 지원`));
 host.append(el('div',{class:'wiki-previews'},docs.map(s=>button([el('div',{class:'eyebrow'},s.domain+' / '+s.kind),el('h2',{},s.name),el('p',{class:'small muted'},s.purpose),el('div',{class:'actions',style:'margin-top:17px'},badge(s.checkStatus),el('span',{class:'text-link'},'사용법 읽기 →'))],()=>openDetail(s.id,'wiki'),'wiki-preview'))));
 if(!docs.length)host.append(empty('검색에 맞는 사용법이 없습니다.','시스템을 등록하거나 검색어를 바꿔보세요.'));
}
function markdown(text){
 const container=el('div',{class:'wiki'});let code=null;
 for(const line of String(text||'아직 작성된 사용법이 없습니다.').split('\n')){
  if(line.startsWith('```')){if(code){container.append(el('pre',{},code.join('\n')));code=null;}else code=[];continue;}
  if(code){code.push(line);continue;}
  const heading=line.match(/^(#{1,3})\s+(.*)$/);
  if(heading){container.append(el('h'+heading[1].length,{},heading[2]));continue;}
  if(/^\s*---\s*$/.test(line)){container.append(el('hr'));continue;}
  const value=line.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1');
  if(/^\s*[-*]\s+/.test(value))container.append(el('p',{class:'list-line'},value.replace(/^\s*[-*]\s+/,'')));
  else if(value.trim())container.append(el('p',{},value));
 }
 if(code)container.append(el('pre',{},code.join('\n')));return container;
}
function modal(title,subtitle,body,actions=[]){
 const dialog=$('#dialog');dialog.replaceChildren(el('div',{class:'dialog-head'},el('div',{},el('h2',{},title),subtitle?el('p',{class:'small muted'},subtitle):null),el('div',{class:'actions'},actions,button('✕',()=>{activeId=null;dialog.close();},'icon-button',{'aria-label':'닫기'}))),el('div',{class:'dialog-body'},body));
 if(!dialog.open)dialog.showModal();
}
function openDetail(id,tab='overview'){
 const s=state.systems[id];if(!s)return;activeId=id;detailTab=tab;
 const tabs=[['overview','개요'],['wiki','사용법'],['relations','연결'],['issues','점검'],['history','변경 기록']];
 const body=el('div',{},el('div',{class:'tab-strip',role:'tablist'},tabs.map(([key,label])=>button(label,()=>openDetail(id,key),key===tab?'active':'',{role:'tab','aria-selected':String(key===tab)}))));
 if(tab==='overview'){
  body.append(el('div',{class:'detail-summary'},fact('분야 · 유형',s.domain+' / '+s.kind),fact('사용 상태',s.usageStatus),fact('점검 상태',s.checkStatus)),block('무엇을 하는 시스템인가',s.purpose));
  if(s.url){const url=safeUrl(s.url);if(url)body.append(el('a',{class:'btn primary',href:url,target:'_blank',rel:'noopener noreferrer'},'↗ 실행 화면 열기'));else body.append(el('p',{class:'error-text'},'접속 주소의 형식을 확인해 주세요.'));}
  if(s.localPath)body.append(el('div',{class:'path-box'},el('code',{},s.localPath),button('복사',()=>copyText(s.localPath),'btn compact',{'aria-label':'폴더 경로 복사'})));
  if(s.legacyUrl)body.append(el('div',{class:'path-box'},el('div',{},el('p',{class:'small muted'},'이전 카드의 로컬 연결 (원문 보존)'),el('code',{},s.legacyUrl)),button('복사',()=>copyText(s.legacyUrl),'btn compact',{'aria-label':'이전 연결 복사'})));
  body.append(block('다음에 할 일',s.nextAction||'기록된 다음 조치가 없습니다.'),block('내 메모',s.notes||'아직 작성한 메모가 없습니다.'));
  if(s.legacyUsage)body.append(block('기존 카드의 사용 안내',s.legacyUsage));
  if(s.legacyAccess)body.append(block('기존 카드의 접속 안내',s.legacyAccess));
  if(s.legacyCaution)body.append(block('기존 카드의 주의사항',s.legacyCaution));
  body.append(el('p',{class:'small muted'},`확인일 ${s.checkedAt||'미확인'} · ${s.checkScope||'기록된 점검 자료 기준'}`));
  if(s.aliases?.length)body.append(el('p',{class:'small muted'},'다른 이름: '+s.aliases.join(' · ')));
 }else if(tab==='wiki'){
  body.append(el('div',{class:'section-toolbar'},el('p',{class:'small muted'},'프로그램별 사용법 · 코드와 비밀값은 별도로 관리하세요.'),button('사용법 편집',()=>editWiki(id),'btn compact')),markdown(s.wiki));
 }else if(tab==='relations'){
  const links=Object.values(state.relations).filter(r=>!r.archived&&(r.from===id||r.to===id));
  for(const relation of links)body.append(relationRow(relation));if(!links.length)body.append(empty('연결 관계가 아직 없습니다.','목록에서 관계를 추가할 수 있습니다.'));
 }else if(tab==='issues'){
  const items=Object.values(state.issues).filter(i=>!i.archived&&i.systemId===id);for(const issue of items)body.append(issueRow(issue));if(!items.length)body.append(empty('기록된 점검 항목이 없습니다.','확인하지 않은 기능의 정상 동작을 뜻하지는 않습니다.'));body.append(button('+ 점검 등록',()=>editIssue(null,id),'btn'));
 }else{
  const items=changes().filter(c=>c.systemId===id);body.append(timeline(items));
 }
 modal(s.name,s.purpose,body,[star(id),button('편집',()=>editSystem(id),'btn compact')]);
}
function fact(title,value){return el('div',{class:'detail-fact'},el('label',{},title),el('p',{},value||'미확인'));}
function block(title,text){return el('section',{class:'detail-block'},el('h3',{},title),el('p',{},text));}
function field(label,name,value='',type='text',choices=null,full=false,hint=''){
 const id='field-'+name;
 const input=choices?el('select',{id,name},choices.map(x=>el('option',{value:x,selected:x===value},x))):type==='textarea'?el('textarea',{id,name,rows:name==='wiki'?18:4,maxlength:name==='wiki'?160000:20000},value):el('input',{id,name,type,value,maxlength:type==='url'?2000:4000,autocomplete:type==='password'?'off':null});
 return el('label',{class:'field'+(full?' full':''),for:id},el('span',{},label),input,hint?el('small',{class:'hint'},hint):null);
}
function editSystem(id=null){
 if(!guardEdit())return;activeId=null;
 const s=state.systems[id]||{name:'',purpose:'',domain:'공통 도구',kind:'웹앱',usageStatus:'미확정',checkStatus:'미확인',notes:'',wiki:''};
 const domains=[...new Set([...systems().map(s=>s.domain),'투자','자산관리','업무·생활','자료·지식','공통 도구'])];
 const form=el('form',{},el('div',{class:'form-grid'},field('시스템 이름','name',s.name),field('분야','domain',s.domain,'text',domains),field('유형','kind',s.kind,'text',['웹앱','API','자동화','모바일 앱','도구','문서','프로젝트']),field('사용 상태','usageStatus',s.usageStatus,'text',['사용 중','개발 중','보류','종료','미확정']),field('점검 상태','checkStatus',s.checkStatus,'text',['정상 확인','문제 있음','미확인']),field('최근 확인일','checkedAt',s.checkedAt||'','date'),field('목적 · 한 줄 설명','purpose',s.purpose,'textarea',null,true),field('실행 화면 주소','url',s.url||'','url',null,true,'웹 주소는 열기 버튼, 로컬 파일은 경로 복사로 사용합니다.'),field('로컬 폴더 · 실행 파일 위치','localPath',s.localPath||'','text',null,true),field('다음 조치','nextAction',s.nextAction||'','textarea',null,true),field('내 메모','notes',s.notes||'','textarea',null,true)),el('p',{class:'error-text',id:'form-error',role:'alert'}));
 const save=el('button',{type:'submit',class:'btn primary'},'변경 저장');
 form.append(el('div',{class:'form-actions'},id?button(s.archived?'보관 해제':'보관함으로',()=>{if(mutate('systems',id,{archived:!s.archived}))$('#dialog').close();},'btn danger'):null,button('취소',()=>id?openDetail(id):$('#dialog').close()),save));
 form.addEventListener('submit',event=>{event.preventDefault();let data=Object.fromEntries(new FormData(form));Object.keys(data).forEach(k=>data[k]=data[k].trim());if(!data.name){$('#form-error').textContent='시스템 이름을 입력해 주세요.';return;}if(data.url&&!safeUrl(data.url)){$('#form-error').textContent='http 또는 https 주소를 입력해 주세요.';return;}const target=id||'system_'+crypto.randomUUID().replaceAll('-','').slice(0,16);if(!id){data.wiki='# '+data.name+'\n\n## 준비\n\n## 실행\n\n## 종료\n\n## 문제 해결\n';data.archived=false;}else data=Object.fromEntries(Object.entries(data).filter(([k,v])=>v!==(s[k]??'')));if(mutate('systems',target,data,[],id?s:null))openDetail(target);});
 modal(id?'시스템 정보 편집':'시스템 등록','실제 프로그램 파일에는 영향을 주지 않고 관리 정보만 변경합니다.',form);
}
function editWiki(id){
 if(!guardEdit())return;activeId=null;const s=state.systems[id];
 const form=el('form',{},field('사용법 문서','wiki',s.wiki||'','textarea',null,true,'제목은 #, 소제목은 ##로 작성하세요. HTML은 코드로 실행되지 않습니다.'),el('div',{class:'form-actions'},button('취소',()=>openDetail(id,'wiki')),el('button',{type:'submit',class:'btn primary'},'사용법 저장')));
 form.addEventListener('submit',event=>{event.preventDefault();if(mutate('systems',id,{wiki:new FormData(form).get('wiki')},[],s))openDetail(id,'wiki');});modal(s.name+' · 사용법 편집','내용과 기존 기록은 변경 이력으로 보존됩니다.',form);
}
function renderIssues(host){
 host.append(pageHeading('점검 · 다음 조치','문제의 근거와 다음 행동을 기록합니다. 완료 처리는 실제 프로그램을 변경하지 않습니다.',[button('+ 점검 등록',()=>editIssue(),'btn primary')]));
 const items=Object.values(state.issues).filter(i=>!i.archived&&(!search||[i.title,i.detail,state.systems[i.systemId]?.name].join(' ').toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>(a.status==='완료'?1:0)-(b.status==='완료'?1:0)||(a.priority==='높음'?0:1)-(b.priority==='높음'?0:1));
 host.append(el('p',{class:'result-count'},`전체 ${items.length}개 · 미완료 ${items.filter(i=>i.status!=='완료').length}개`));
 if(!items.length){host.append(empty('기록된 점검이 없습니다.','새 문제가 생기면 시스템과 연결해 등록하세요.'));return;}
 host.append(el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},['점검 항목','관련 시스템','우선순위','상태','확인일'].map(x=>el('th',{},x)))),el('tbody',{},items.map(i=>el('tr',{},el('td',{},button(i.title,()=>openIssue(i.id),'system-name')),el('td',{},state.systems[i.systemId]?.name||'공통'),el('td',{},badge(i.priority)),el('td',{},badge(i.status)),el('td',{class:'small muted'},i.checkedAt||'미확인')))))));
}
function openIssue(id){
 activeId=null;const issue=state.issues[id];if(!issue)return;
 modal(issue.title,state.systems[issue.systemId]?.name||'공통 점검',el('div',{},el('div',{class:'actions',style:'margin-bottom:20px'},badge(issue.status),badge(issue.priority)),block('확인한 내용',issue.detail),block('다음 조치',issue.nextAction||'내용을 확인하고 조치를 기록해 주세요.'),el('p',{class:'small muted'},'기준일 '+(issue.checkedAt||'미확인')),el('div',{class:'form-actions'},issue.systemId?button('시스템 보기',()=>openDetail(issue.systemId,'issues')):null,button('편집',()=>editIssue(id)),button(issue.status==='완료'?'다시 열기':'완료로 기록',()=>{if(mutate('issues',id,{status:issue.status==='완료'?'미처리':'완료'}))openIssue(id);},'btn primary'))));
}
function editIssue(id=null,systemId=''){
 if(!guardEdit())return;activeId=null;const item=state.issues[id]||{title:'',systemId,priority:'보통',status:'미처리',detail:'',nextAction:'',checkedAt:new Date().toISOString().slice(0,10)};
 const select=el('select',{name:'systemId','aria-label':'관련 시스템'},el('option',{value:''},'공통'),systems().filter(s=>!s.archived).map(s=>el('option',{value:s.id,selected:s.id===item.systemId},s.name)));
 const form=el('form',{},el('div',{class:'form-grid'},field('점검 제목','title',item.title,'text',null,true),el('label',{class:'field'},el('span',{},'관련 시스템'),select),field('우선순위','priority',item.priority,'text',['높음','보통','낮음']),field('처리 상태','status',item.status,'text',['미처리','진행 중','완료']),field('확인일','checkedAt',item.checkedAt,'date'),field('확인한 내용 · 근거','detail',item.detail,'textarea',null,true),field('다음 조치','nextAction',item.nextAction,'textarea',null,true)),el('p',{id:'form-error',class:'error-text'}),el('div',{class:'form-actions'},button('취소',()=>$('#dialog').close()),el('button',{type:'submit',class:'btn primary'},'점검 저장')));
 form.addEventListener('submit',event=>{event.preventDefault();let data=Object.fromEntries(new FormData(form));if(!data.title.trim()){$('#form-error').textContent='제목을 입력해 주세요.';return;}const target=id||'issue_'+crypto.randomUUID().replaceAll('-','').slice(0,16);if(id)data=Object.fromEntries(Object.entries(data).filter(([k,v])=>v!==(item[k]??'')));if(mutate('issues',target,data,[],id?item:null))openIssue(target);});modal(id?'점검 편집':'새 점검 등록','실행 여부와 확인한 범위를 함께 기록하세요.',form);
}
function relationRow(r){return el('div',{class:'relation-row'},button(state.systems[r.from]?.name||r.from,()=>openDetail(r.from),'text-link'),el('span',{},'→'),button(state.systems[r.to]?.name||r.to,()=>openDetail(r.to),'text-link'),el('span',{class:'relation-label'},r.label),badge(r.confidence||'확인'),button('편집',()=>editRelation(r.id),'text-link'));}
function renderRelations(host){
 host.append(pageHeading('연결 관계','입력 → 처리 → 활용 흐름을 따라 관련 시스템을 찾아갑니다.',[button('+ 관계 추가',()=>editRelation(),'btn primary')]));
 const links=Object.values(state.relations).filter(r=>!r.archived&&state.systems[r.from]&&state.systems[r.to]);
 const flows=[...new Set(links.map(r=>r.workflow||'기타'))];if(!flows.includes(flow))flow=flows[0]||'';
 host.append(el('div',{class:'filters'},flows.map(f=>button(f,()=>{flow=f;render();},'filter-chip'+(flow===f?' active':'')))));
 const selected=links.filter(r=>(r.workflow||'기타')===flow);
 if(!selected.length){host.append(empty('연결 관계를 등록해 보세요.','어느 시스템의 결과를 다음에 어디서 사용하는지 기록합니다.'));return;}
 host.append(drawGraph(selected));const list=el('section',{class:'panel relation-list'},selected.map(relationRow));host.append(list,el('p',{class:'footer-note'},'실선은 확인된 연결, 점선은 계획 단계 연결입니다. 시스템을 누르면 사용법과 자료 위치를 볼 수 있습니다.'));
}
function svgNode(name,attrs={},text=null){const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);if(text!==null)node.textContent=text;return node;}
function drawGraph(links){
 const ids=[...new Set(links.flatMap(r=>[r.from,r.to]))],levels=Object.fromEntries(ids.map(id=>[id,0]));
 for(let round=0;round<ids.length;round++){let changed=false;for(const r of links)if(levels[r.to]<=levels[r.from]&&levels[r.from]<ids.length-1){levels[r.to]=levels[r.from]+1;changed=true;}if(!changed)break;}
 const columns={};ids.forEach(id=>(columns[levels[id]]??=[]).push(id));
 const max=Math.max(...Object.values(columns).map(x=>x.length)),width=Math.max(700,(Math.max(...Object.values(levels))+1)*240+50),height=Math.max(300,max*130+70);const positions={};
 for(const [level,group]of Object.entries(columns))group.forEach((id,i)=>positions[id]={x:35+Number(level)*240,y:35+(height-70)/group.length*(i+.5)-40});
 const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,width,height,role:'img','aria-label':flow+' 작업 흐름'});const defs=svgNode('defs'),marker=svgNode('marker',{id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(svgNode('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#8aa89a'}));defs.append(marker);svg.append(defs);
 for(const r of links){const a=positions[r.from],b=positions[r.to],x=a.x+190,y=a.y+38;svg.append(svgNode('path',{d:`M${x},${y} C${x+25},${y} ${b.x-30},${b.y+38} ${b.x-8},${b.y+38}`,fill:'none',stroke:'#9bb7a8','stroke-width':1.6,'stroke-dasharray':r.confidence==='계획'?'5 4':'','marker-end':'url(#arrow)'}));}
 for(const id of ids){const s=state.systems[id],{x,y}=positions[id],g=svgNode('g',{class:'graph-node',role:'button',tabindex:0,'aria-label':s.name+' 상세 보기'});g.append(svgNode('rect',{x,y,width:190,height:78,rx:12,fill:'#fff',stroke:'#cfdfd4'}),svgNode('text',{x:x+15,y:y+29,fill:'#203c30','font-size':15,'font-weight':600},s.name.length>13?s.name.slice(0,12)+'…':s.name),svgNode('text',{x:x+15,y:y+54,fill:'#81968a','font-size':12},s.domain+' · '+s.kind),svgNode('title',{},s.name+' — '+s.purpose));g.addEventListener('click',()=>openDetail(id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(id);}});svg.append(g);}
 return el('div',{class:'graph-wrap'},svg);
}
function editRelation(id=null){
 if(!guardEdit())return;activeId=null;
 const original=state.relations[id]||{label:'',workflow:flow||'기타',confidence:'확인'};
 const select=(name)=>el('label',{class:'field'},el('span',{},name==='from'?'자료를 보내는 시스템':'자료를 받는 시스템'),el('select',{name},systems().filter(s=>!s.archived).map(s=>el('option',{value:s.id,selected:s.id===original[name]},s.name))));
 const form=el('form',{},el('div',{class:'form-grid'},select('from'),select('to'),field('연결 설명','label',original.label,'text',null,true),field('작업 흐름 이름','workflow',original.workflow),field('확인 수준','confidence',original.confidence,'text',['확인','계획'])),el('p',{id:'form-error',class:'error-text'}),el('div',{class:'form-actions'},id?button('관계 보관',()=>{if(mutate('relations',id,{archived:true})){navigate('relations');}},'btn danger'):null,button('취소',()=>$('#dialog').close()),el('button',{class:'btn primary',type:'submit'},'관계 저장')));
 form.addEventListener('submit',event=>{event.preventDefault();let data=Object.fromEntries(new FormData(form));if(data.from===data.to||!data.label.trim()){$('#form-error').textContent='서로 다른 시스템과 연결 설명을 입력해 주세요.';return;}if(id)data=Object.fromEntries(Object.entries(data).filter(([k,v])=>v!==(original[k]??'')));if(mutate('relations',id||'relation_'+crypto.randomUUID().replaceAll('-','').slice(0,16),data,[],id?original:null)){$('#dialog').close();navigate('relations');}});modal(id?'연결 관계 편집':'연결 관계 등록','계획 단계의 연결은 점선으로 표시합니다.',form);
}
function timeline(items){if(!items.length)return empty('변경 기록이 없습니다.');return el('div',{class:'timeline'},items.slice(0,120).map(c=>el('article',{class:'timeline-entry'},el('time',{},formatDate(c.at)+' '+formatTime(c.at)),el('p',{},c.title),el('p',{class:'small'},c.source||'검토 기록'),c.detail?el('p',{class:'small'},c.detail):null)));}
function renderChanges(host){host.append(pageHeading('변경 기록','검토와 직접 편집한 내용을 남깁니다. 기기 간 저장은 개별 기록으로 보존합니다.'),timeline(changes()));}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('복사했습니다.');}catch{modal('내용 복사','아래 내용을 선택해 복사하세요.',el('pre',{class:'wiki'},text));}}
function exportData(){if(!guardEdit())return;const data=exportSnapshot(state);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=el('a',{href:url,download:`control-tower-backup-${new Date().toISOString().slice(0,10)}.json`});link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('자료를 내보냈습니다. 인증 토큰은 포함하지 않습니다.');}
function showConflicts(){
 activeId=null;
 const body=el('div',{},el('p',{class:'small muted',style:'margin-bottom:20px'},'같은 필드를 두 기기에서 수정했습니다. 다른 필드는 그대로 유지됩니다. 선택한 결과도 변경 기록으로 보존합니다.'));
 for(const c of state.conflicts){const record=state[c.entity][c.target];const apply=value=>{const event=makeEvent(state,c.entity,c.target,{[c.field]:value},actor,[c.id]);if(event){pending=mergeEvents(pending,[event]);recompute();render();void flush();}if(state.conflicts.length)showConflicts();else $('#dialog').close();};body.append(el('section',{class:'conflict-card'},el('h3',{},`${record?.name||record?.title||c.target} · ${fieldName(c.field)}`),el('div',{class:'conflict-values'},el('div',{},el('p',{class:'small muted'},'현재 적용된 내용'),el('pre',{},pretty(c.current))),el('div',{},el('p',{class:'small muted'},'다른 기기의 변경'),el('pre',{},pretty(c.incoming)))),el('div',{class:'actions'},button('현재 내용 유지',()=>apply(c.current)),button('다른 기기 내용 적용',()=>apply(c.incoming),'btn primary'))));}
 modal('겹치는 변경 비교',`${state.conflicts.length}개 필드 · 한쪽을 선택하기 전까지 모두 보존합니다.`,body);
}
function openSettings(message=''){
 activeId=null;const cfg=config();
 const form=el('form',{},el('p',{class:'small muted',style:'margin-bottom:18px'},message||'기존 컨트롤타워의 Gist ID와 토큰을 이어서 사용합니다. 토큰은 이 브라우저에만 저장하며 내보내기 자료에 포함하지 않습니다.'),el('div',{class:'form-grid'},field('Gist ID','gistId',cfg.id,'text',null,true),field('GitHub 토큰','token',cfg.token,'password',null,true,'기존 비공개 Gist 읽기·쓰기 권한이 필요합니다.')),el('p',{class:'error-text',id:'settings-error'}),el('div',{class:'form-actions'},button('최신 자료 불러오기',()=>{void refresh();}),el('button',{type:'submit',class:'btn primary'},'연결 설정 저장')));
 form.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));if(!/^[0-9a-f]{20,64}$/i.test(data.gistId.trim())||!data.token.trim()){$('#settings-error').textContent='Gist ID와 토큰을 입력해 주세요.';return;}const changed=cfg.id!==data.gistId.trim();if(changed&&pending.length){$('#settings-error').textContent='미전송 변경이 있습니다. 현재 Gist로 동기화하거나 JSON을 내보낸 뒤 연결을 바꿔 주세요.';return;}localStorage.setItem('ct_gist_id',data.gistId.trim());localStorage.setItem('ct_gist_token',data.token.trim());if(changed){remoteEvents=[];remoteReadSucceeded=false;}$('#dialog').close();await refresh();});
 form.append(el('hr',{style:'margin:24px 0;border:0;border-top:1px solid var(--line)'}),el('h3',{},'자료 보관 · 가져오기'),el('p',{class:'small muted',style:'margin:10px 0 16px'},'기존 v3 Gist 자료는 유지됩니다. v4의 변경은 고유한 파일에 추가되어 다른 기기의 수정 전체를 덮어쓰지 않습니다.'),el('div',{class:'actions'},button('JSON 백업 내보내기',exportData),button('JSON 자료 가져오기',()=>importPicker()),button('이전 기기 자료 확인',legacyImport)),el('p',{class:'footer-note'},pending.length?`미전송 변경 ${pending.length}개가 이 기기에 보관되어 있습니다.`:'미전송 변경 없음 · 자동 불러오기 주기 약 60초'));
 modal('연결 · 자료 관리',syncMessage||'비공개 Gist 동기화',form);
}
function importPicker(){if(!guardEdit())return;const picker=el('input',{type:'file',accept:'.json,application/json'});picker.onchange=async()=>{try{const file=picker.files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('8MB 이하의 JSON을 선택해 주세요.');const data=validateBase(JSON.parse(await file.text()));const rows=[];for(const entity of ['systems','issues','relations'])for(const[id,item]of Object.entries(data[entity])){const updates=Object.fromEntries(Object.entries(item).filter(([key])=>!['id','updatedAt'].includes(key)));if(Object.entries(updates).some(([k,v])=>JSON.stringify(state[entity][id]?.[k]??null)!==JSON.stringify(v??null)))rows.push({entity,id,updates});}showImport(rows,'백업 JSON 가져오기');}catch(error){toast(error.message,true);}};picker.click();}
function showImport(rows,title){
 const body=el('div',{},el('p',{},`${rows.length}개 항목의 차이가 있습니다. 기존에만 있는 항목은 삭제하지 않습니다.`),el('div',{class:'detail-block',style:'margin-top:18px'},rows.slice(0,25).map(r=>el('p',{class:'small'},r.updates.name||r.updates.title||state[r.entity]?.[r.id]?.name||r.id))),el('div',{class:'form-actions'},button('취소',()=>$('#dialog').close()),button('차이를 변경 기록으로 가져오기',()=>{for(const row of rows){const event=makeEvent(state,row.entity,row.id,row.updates,actor);if(event){pending=mergeEvents(pending,[event]);recompute();}}render();$('#dialog').close();void flush();toast(`${rows.length}개 항목의 변경을 기기에 보관했습니다.`);},'btn primary',{disabled:!rows.length})));
 modal(title,'기존 자료를 삭제하지 않는 병합 가져오기',body);
}
function legacyImport(){
 if(!guardEdit())return;const local=storage.get('ct_local_data');const overrides=local?.catalogOverrides;if(!overrides){toast('이 브라우저에 이전 버전 자료가 없습니다.');return;}
 const remote=base.metadata?.legacySnapshot||{},map=base.legacyMap||{},rows=[];
 const fieldMap={name:'name',desc:'purpose',access:'legacyAccess',usage:'legacyUsage',caution:'legacyCaution',link:'url',memo:'notes',status:'usageStatus'};
 const convert=(value,field)=>field==='status'?({'운영중':'사용 중','개발중':'개발 중','중단됨':'종료','확인 필요':'미확정'}[value]||'미확정'):value;
 const compare=(key,item,old)=>{const id=map[key];if(!id||!state.systems[id])return;const updates={};for(const[field,to]of Object.entries(fieldMap))if(field in item&&JSON.stringify(item[field])!==JSON.stringify(old?.[field]))updates[to]=convert(item[field],field);if(Object.keys(updates).length)rows.push({entity:'systems',id,updates});};
 for(const[key,item]of Object.entries(overrides))if(key!=='__custom__')compare(key,item,remote[key]);
 for(const[domain,items]of Object.entries(overrides.__custom__||{}))for(const item of items){
  if(!state.systems[map[item.key]||item.key]){
   const url=safeUrl(item.link||'');
   rows.push({entity:'systems',id:item.key,updates:{name:item.name||'이전 프로그램',purpose:item.desc||'',domain:['미장','국장'].includes(domain)?'투자':domain,kind:'프로젝트',usageStatus:convert(item.status,'status'),checkStatus:'미확인',notes:item.memo||'',url:url||'',legacyUrl:!url?(item.link||''):'',legacyAccess:item.access||'',legacyUsage:item.usage||'',legacyCaution:item.caution||'',wiki:'# '+(item.name||'이전 프로그램')+'\n\n## 접속\n'+(item.access||'')+'\n\n## 사용법\n'+(item.usage||'')+'\n\n## 주의\n'+(item.caution||''),archived:false}});
  }else compare(item.key,item,(remote.__custom__?.[domain]||[]).find(x=>x.key===item.key));
 }
 showImport(rows,'이전 브라우저 자료의 차이 확인');
}
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){activeId=null;$('#dialog').close();}}});
$('#dialog').addEventListener('cancel',()=>activeId=null);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#global-query').focus();}});
function parseHash(){const hash=location.hash.slice(1);if(hash.startsWith('system=')){const id=decodeURIComponent(hash.slice(7));view='systems';render();openDetail(id);return;}if(navItems.some(n=>n[0]===hash))view=hash;render();}
window.addEventListener('hashchange',parseHash);
window.addEventListener('online',()=>void refresh());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&config().token)void sync({silent:true}).then(()=>flush());});
setInterval(()=>{if(document.visibilityState==='visible'&&config().token&&!flushing)void sync({silent:true}).then(()=>flush());},60000);
parseHash();
if(config().id&&config().token)void sync({silent:true}).then(()=>flush());
// Read-only test hooks: no credentials or write entrypoints are exposed.
window.controlTowerStatus=()=>({version:VERSION,systems:systems().length,pending:pending.length,conflicts:state.conflicts.length,connected,syncState});
