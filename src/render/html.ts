import type { ReviewSnapshot } from '../types.js';

function embed(data: ReviewSnapshot): string {
  return JSON.stringify(data)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--line:#e6e8eb;--text:#1f2328;--muted:#6b7280;--up:#d92b2b;--down:#16a34a;--accent:#2563eb;--chip:#f1f3f6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1680px;margin:0 auto;padding:24px 28px 48px}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:24px;margin:0 0 6px;letter-spacing:.5px}
.sub{color:var(--muted);font-size:13px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--muted)}
.badge b{color:var(--text);font-weight:600}
.badge.live{color:#0b7a3b;border-color:#a7dfc0;background:#effaf3}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card .label{color:var(--muted);font-size:12px;margin-bottom:8px}
.card .value{font-size:28px;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
.card .foot{color:var(--muted);font-size:12px;margin-top:6px}
.up{color:var(--up)}.down{color:var(--down)}
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-bottom:16px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.panel h2{font-size:15px;margin:0 0 14px;font-weight:650}
.ladder-row{display:grid;grid-template-columns:52px 1fr 44px;align-items:center;gap:10px;margin-bottom:9px;font-size:13px}
.bar-track{background:var(--chip);border-radius:6px;height:10px;overflow:hidden}
.bar{height:10px;border-radius:6px;background:linear-gradient(90deg,#f0a3a3,#d92b2b);min-width:2px}
.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.hint{margin-top:12px;padding:10px 12px;background:#fff7ed;border:1px solid #fde4c4;border-radius:8px;color:#9a5b13;font-size:13px}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
input[type=search],select{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 11px;font-size:13px;color:var(--text);outline:none}
input[type=search]{min-width:240px}
input[type=search]:focus,select:focus{border-color:var(--accent)}
.count{margin-left:auto;color:var(--muted);font-size:13px}
.tablecard{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
thead th{position:sticky;top:0;background:#fafbfc;border-bottom:1px solid var(--line);text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:11px 14px;white-space:nowrap;cursor:pointer;user-select:none;z-index:2}
thead th:hover{color:var(--accent)}
tbody td{padding:10px 14px;border-bottom:1px solid #f0f1f3;white-space:nowrap}
tbody tr:hover{background:#fafbfc}
tbody tr:last-child td{border-bottom:none}
.idx{color:var(--muted);width:46px}
.stock b{font-weight:600}.stock small{display:block;color:var(--muted);font-size:12px;letter-spacing:.4px}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:#fff1f0;color:var(--up);border:1px solid #ffd4d1;margin-right:4px}
.time{font-weight:600}.board{color:var(--accent);font-size:12px}
.reason{font-weight:500}.rcount{color:var(--muted);font-size:12px;margin-left:4px}
.seal{text-align:right;font-weight:600;color:var(--up)}
.empty{padding:34px;text-align:center;color:var(--muted);font-size:13px;line-height:1.9}
footer{margin-top:18px;color:var(--muted);font-size:12px;line-height:1.9}
.svgwrap{width:100%;overflow-x:auto}
.chart-note{color:var(--muted);font-size:12px;margin-top:8px}
.dist{display:flex;gap:2px;align-items:flex-end;height:70px;margin-top:8px}
.dist i{flex:1;background:#cbd5e1;border-radius:2px 2px 0 0;min-height:2px}
.dist i.neg{background:#86cf9f}.dist i.pos{background:#ee9b9b}
.dist-labels{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:5px}
`;

const JS = String.raw`
const DATA_EL=document.getElementById('kpl-data');
let data=JSON.parse(DATA_EL.textContent);
let sortKey='time',sortDir=1,keyword='',reasonFilter='';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wan=v=>v>=10000?(v/10000).toFixed(2)+'亿':Math.round(v)+'万';
const pct=v=>(v>0?'+':'')+v.toFixed(2)+'%';
function renderKpis(){
  const o=data.overview,rows=data.rows;
  const totalSeal=rows.reduce((s,r)=>s+(r.sealWan||0),0);
  const today=o.history.find(h=>h.day===data.date);
  const broken=o.brokenBoard.find(b=>b.day===data.date);
  const cards=[
    ['涨停家数',o.limitUpCount==null?'—':o.limitUpCount,'up','市场情绪 · 当日'],
    ['跌停家数',o.limitDownCount==null?'—':o.limitDownCount,'down','市场情绪 · 当日'],
    ['最高连板',today?today.ladderHeight+'板':'—','','多日统计'],
    ['破板数',broken?broken.broken:'—','',broken?'破板率 '+broken.ratio.toFixed(1)+'%':'多日统计'],
    ['已载明细',rows.length,'',rows.length?'封单合计 '+(totalSeal?wan(totalSeal):'—'):'运行 sniff 补全']
  ];
  document.getElementById('kpis').innerHTML=cards.map(c=>
    '<div class="card"><div class="label">'+esc(c[0])+'</div><div class="value '+c[2]+'">'+esc(c[1])+'</div><div class="foot">'+esc(c[3])+'</div></div>').join('');
}
function renderLadder(){
  const o=data.overview,max=Math.max(1,...o.ladder);
  document.getElementById('ladder').innerHTML=o.ladder.map((v,i)=>
    '<div class="ladder-row"><span>'+esc(o.ladderLabels[i]||('第'+(i+1)+'级'))+'</span>'+
    '<div class="bar-track"><div class="bar" style="width:'+(v/max*100).toFixed(1)+'%"></div></div>'+
    '<span class="num">'+v+'</span></div>').join('')||'<div class="empty">暂无梯队数据</div>';
  const e=o.expression;
  const hint=o.expressionHint?'<div class="hint">'+esc(o.expressionHint)+'</div>':'';
  const stat=e.length?('<div class="hint" style="background:#f0f7ff;border-color:#cfe0ff;color:#1d4ed8">情绪指标序列：'+esc(e.join(' / '))+'</div>'):'';
  document.getElementById('expression').innerHTML=hint+stat;
}
function renderHistory(){
  const h=data.overview.history.slice(0,24).reverse();
  if(!h.length){document.getElementById('history').innerHTML='<div class="empty">暂无历史数据</div>';return;}
  const W=Math.max(560,h.length*32),H=170,pad=28;
  const maxUp=Math.max(1,...h.map(x=>x.limitUp)),maxLb=Math.max(1,...h.map(x=>x.ladderHeight));
  const bw=(W-pad*2)/h.length;
  let bars='',line='',labels='';
  h.forEach((p,i)=>{
    const bh=(p.limitUp/maxUp)*(H-pad*2);
    const x=pad+i*bw+bw*0.2,y=H-pad-bh;
    bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.6).toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="2" fill="#ee9b9b"/>';
    const ly=H-pad-(p.ladderHeight/maxLb)*(H-pad*2);
    line+=(i?' L':'M')+(pad+i*bw+bw/2).toFixed(1)+' '+ly.toFixed(1);
    if(i%Math.ceil(h.length/8)===0) labels+='<text x="'+(pad+i*bw+bw/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(p.day.slice(5))+'</text>';
  });
  document.getElementById('history').innerHTML='<div class="svgwrap"><svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+
    '<line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e6e8eb"/>'+bars+
    '<path d="'+line+'" fill="none" stroke="#2563eb" stroke-width="2"/>'+labels+'</svg></div>'+
    '<div class="chart-note">红柱＝涨停家数（峰值 '+maxUp+'）　蓝线＝最高连板（峰值 '+maxLb+' 板）　近 '+h.length+' 个交易日</div>';
}
function renderDistribution(){
  const d=data.overview.distribution;
  const keys=Object.keys(d).map(Number).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
  if(!keys.length){document.getElementById('distribution').innerHTML='<div class="empty">暂无涨跌分布</div>';return;}
  const max=Math.max(1,...keys.map(k=>d[String(k)]||0));
  document.getElementById('distribution').innerHTML='<div class="dist">'+keys.map(k=>{
    const v=d[String(k)]||0,h=Math.max(2,v/max*70);
    return '<i class="'+(k<0?'neg':k>0?'pos':'')+'" style="height:'+h+'px" title="'+k+'% : '+v+'家"></i>';
  }).join('')+'</div><div class="dist-labels"><span>'+keys[0]+'%</span><span>0</span><span>+'+keys[keys.length-1]+'%</span></div>'+
  '<div class="chart-note">绿＝下跌家数　红＝上涨家数，悬停查看每档数量</div>';
}
function renderSideTables(){
  const w=data.overview.withdrawals.slice(0,12);
  document.getElementById('withdrawals').innerHTML=w.length?('<table><thead><tr><th>股票</th><th>现价</th><th>回撤</th></tr></thead><tbody>'+
    w.map(x=>'<tr><td class="stock"><b>'+esc(x.name)+'</b><small>'+esc(x.code)+'</small></td><td>'+x.price.toFixed(2)+'</td><td class="down">'+pct(x.drop)+'</td></tr>').join('')+
    '</tbody></table>'):'<div class="empty">暂无大幅回撤数据</div>';
  const up=data.overview.weightSectors.up.slice(0,8),down=data.overview.weightSectors.down.slice(0,8);
  const row=x=>'<tr><td>'+esc(x.plateName)+'</td><td class="'+(x.change>0?'up':x.change<0?'down':'')+'">'+pct(x.change)+'</td><td>'+esc(x.leaderName)+'</td><td class="'+(x.leaderChange>0?'up':'down')+'">'+pct(x.leaderChange)+'</td></tr>';
  document.getElementById('weights').innerHTML=(up.length||down.length)?
    ('<table><thead><tr><th>板块</th><th>涨跌</th><th>领涨/领跌股</th><th>幅度</th></tr></thead><tbody>'+up.map(row).join('')+down.map(row).join('')+'</tbody></table>')
    :'<div class="empty">暂无权重板块数据</div>';
}
function renderDetail(){
  const rows=data.rows.slice();
  const reasons=Array.from(new Set(rows.map(r=>r.reason).filter(Boolean))).sort();
  const sel=document.getElementById('reason-filter');
  const prev=sel.value;
  sel.innerHTML='<option value="">全部题材</option>'+reasons.map(r=>'<option value="'+esc(r)+'">'+esc(r)+'</option>').join('');
  if(reasons.includes(prev))sel.value=prev;
  let list=rows.filter(r=>(!keyword||r.name.includes(keyword)||r.code.includes(keyword)||r.reason.includes(keyword))&&(!reasonFilter||r.reason===reasonFilter));
  list.sort((a,b)=>{
    let va=a[sortKey],vb=b[sortKey];
    if(sortKey==='sealWan'){va=Number(va)||0;vb=Number(vb)||0;}
    else{va=String(va||'99:99');vb=String(vb||'99:99');}
    return (va>vb?1:va<vb?-1:0)*sortDir;
  });
  document.getElementById('row-count').textContent='共 '+list.length+' 行 / 采集 '+data.rows.length+' 行';
  if(!list.length){
    document.getElementById('detail-body').innerHTML='<tr><td colspan="8"><div class="empty">暂无个股明细<br>在 App 里点一次日期，运行 <b>pnpm dev sniff</b> 拦截真实接口后即可自动加载</div></td></tr>';
    return;
  }
  document.getElementById('detail-body').innerHTML=list.map((r,i)=>
    '<tr><td class="idx">'+(i+1)+'</td><td class="stock"><b>'+esc(r.name)+'</b><small>'+esc(r.code)+'</small>'+
    (r.tags.length?'<div>'+r.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')+'</td>'+
    '<td class="time">'+esc(r.time||'—')+'</td><td class="board">'+esc(r.boardNote||'—')+'</td>'+
    '<td class="reason">'+esc(r.reason||'—')+(r.reasonCount?'<span class="rcount">('+r.reasonCount+')</span>':'')+'</td>'+
    '<td>'+esc(r.reasonCount||'—')+'</td><td class="seal">'+esc(r.sealText||'—')+'</td><td>'+esc(r.sealWan?wan(r.sealWan):'—')+'</td></tr>').join('');
}
function renderAll(){
  const t=new Date(data.capturedAt);
  document.getElementById('meta').textContent='采集于 '+t.toLocaleString('zh-CN')+'　·　接口成功 '+data.meta.okCount+' / 失败 '+data.meta.failCount+'　·　明细来源：'+data.meta.detailSource;
  document.getElementById('date-badge').textContent=data.date;
  renderKpis();renderLadder();renderHistory();renderDistribution();renderSideTables();renderDetail();
}
document.querySelectorAll('#detail-head th').forEach((th,i)=>th.addEventListener('click',()=>{
  const keys=['idx','name','time','boardNote','reason','reasonCount','sealText','sealWan'];
  const k=keys[i];if(!k||k==='idx')return;
  if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=1;}
  renderDetail();
}));
document.getElementById('search').addEventListener('input',e=>{keyword=e.target.value.trim();renderDetail();});
document.getElementById('reason-filter').addEventListener('change',e=>{reasonFilter=e.target.value;renderDetail();});
renderAll();
if(document.body.dataset.live==='1'){
  const ms=Number(document.body.dataset.refresh||3000);
  setInterval(async()=>{
    try{const r=await fetch('/api/snapshot',{cache:'no-store'});if(!r.ok)return;data=await r.json();renderAll();}
    catch(e){}
  },ms);
}
`;

export function renderHtml(data: ReviewSnapshot, opts: { live?: boolean; refreshMs?: number } = {}): string {
  const live = opts.live ? '1' : '0';
  const refresh = String(opts.refreshMs ?? 3000);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开盘啦 · 涨停表现复盘 ${data.date}</title>
<style>${CSS}</style>
</head>
<body data-live="${live}" data-refresh="${refresh}">
<div class="wrap">
  <header class="top">
    <div>
      <h1>涨停表现 · 宽屏复盘</h1>
      <div class="sub">开盘啦「市场情绪 → 涨停表现 → 更多」数据宽屏重排　<span id="meta"></span></div>
    </div>
    <div class="badges">
      <span class="badge">交易日 <b id="date-badge">${data.date}</b></span>
      <span class="badge ${live === '1' ? 'live' : ''}">${live === '1' ? '● 实时刷新' : '静态快照'}</span>
      <span class="badge">红涨 / 绿跌</span>
    </div>
  </header>

  <div class="grid" id="kpis"></div>

  <div class="panels">
    <section class="panel"><h2>连板梯队</h2><div id="ladder"></div><div id="expression"></div></section>
    <section class="panel"><h2>近 N 日情绪趋势</h2><div id="history"></div></section>
    <section class="panel"><h2>涨跌家数分布</h2><div id="distribution"></div></section>
    <section class="panel"><h2>权重板块表现</h2><div id="weights"></div></section>
  </div>

  <section class="panel" style="margin-bottom:16px"><h2>涨停个股明细</h2>
    <div class="toolbar">
      <input type="search" id="search" placeholder="搜索股票名称 / 代码 / 题材">
      <select id="reason-filter"><option value="">全部题材</option></select>
      <span class="count" id="row-count"></span>
    </div>
    <div class="tablecard"><table>
      <thead><tr id="detail-head"><th>#</th><th>股票名称 / 代码</th><th>涨停时间</th><th>连板</th><th>涨停原因</th><th>题材家数</th><th>封单</th><th>封单(归一)</th></tr></thead>
      <tbody id="detail-body"></tbody>
    </table></div>
  </section>

  <section class="panel" style="margin-bottom:16px"><h2>大幅回撤</h2><div class="tablecard" id="withdrawals"></div></section>

  <footer>
    数据来源：开盘啦 <code>apphis.kaipanla.com</code> 公开接口（GET+Day / POST+Date，免登录，按交易日回溯）；明细来自 <code>DailyLimitPerformance</code> / <code>DailyLimitPerformance2</code>，字段已用辅助功能读取 App 实际显示值校准。<br>
    本页面仅供个人复盘，数据以 App 实际展示为准。${data.meta.notes.length ? `<br>提示：${data.meta.notes.join('；')}` : ''}
  </footer>
</div>
<script id="kpl-data" type="application/json">${embed(data)}</script>
<script>${JS}</script>
</body>
</html>`;
}
