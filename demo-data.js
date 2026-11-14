// Public introduction only. Personal paths, notes and audited records live in the private Gist.
const items = [
 ['seed','SEED','자산관리','웹앱','자산·손익·가계부를 모아 보는 대시보드'],
 ['invest_dashboard','Invest','투자','웹앱','투자 전략과 운용 기록을 모아 보는 화면'],
 ['vr','VR','투자','웹앱','VR 전략의 사이클과 매수·매도 표 관리'],
 ['auto_mumae','자동무매','투자','자동화','무한매수 전략 자동화'],
 ['manual_mumae','수동무매','투자','웹앱','수동 매매 기록과 체결 알림 관리'],
 ['stock_alarm','Stock Alarm','투자','자동화','전략 조건에 따른 관찰 알림'],
 ['fornext_pipeline','ForNext','투자','프로젝트','단타 분석 파이프라인 기록'],
 ['fornext_api','ForNext API','투자','API','실시간 시세와 후보 알림'],
 ['ganghan_gisa','강한기사','자료·지식','도구','기사와 재료 정리'],
 ['stock_history','STOCK HISTORY','자료·지식','도구','종목 히스토리 갱신 도구'],
 ['cardview','단타카드뷰','투자','웹앱','관찰 종목과 시나리오 조회'],
 ['invest_data_summary','투자데이터 종합','자료·지식','문서','투자 규칙과 원문 근거 연결'],
 ['indicator_api','지표API','투자','API','시장 지표 수집과 브리핑'],
 ['real_chart','Real Chart','자산관리','웹앱','부동산·유동성 지표 차트']
];
export const demoBase = {version:4,metadata:{demo:true,title:'컨트롤타워',checkedAt:'',description:'연결 전에는 공개된 기존 프로그램의 안내 목록을 보여줍니다.'},systems:Object.fromEntries(items.map(([id,name,domain,kind,purpose]) => [id,{id,name,domain,kind,purpose,usageStatus:'미확정',checkStatus:'미확인',wiki:'Gist를 연결하면 기존 메모와 상세 사용법을 불러옵니다.',notes:'',url:'',localPath:'',nextAction:'Gist 연결 후 실제 검토 자료를 확인하세요.'}])),issues:{},relations:{},workflows:[],changeLog:[],legacyMap:{}};
