import type { YearReview } from '../types.js';

function embed(data: YearReview): string {
  return JSON.stringify(data)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

const CSS = `
:root{--bg:#f4f6f9;--card:#fff;--line:#e5e8ed;--text:#1c2128;--muted:#6b7280;--up:#d92b2b;--down:#16a34a;--accent:#2563eb;--chip:#f1f3f6;--heat1:#ffe9e7;--heat2:#ffc9c4;--heat3:#f79b93;--heat4:#e85c50;--heat5:#c62828}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1720px;margin:0 auto;padding:24px 28px 56px}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:25px;margin:0 0 6px;letter-spacing:.4px}
.sub{color:var(--muted);font-size:13px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--muted)}
.badge b{color:var(--text);font-weight:650}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:13px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 17px}
.card .label{color:var(--muted);font-size:12px;margin-bottom:7px}
.card .value{font-size:26px;font-weight:650;line-height:1.12;font-variant-numeric:tabular-nums}
.card .foot{color:var(--muted);font-size:12px;margin-top:6px}
.up{color:var(--up)}.down{color:var(--down)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
.panel h2{font-size:15px;margin:0 0 14px;font-weight:650;display:flex;align-items:center;gap:10px}
.panel h2 small{font-weight:400;color:var(--muted);font-size:12px}
.two{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(360px,1fr);gap:16px}
@media(max-width:1100px){.two{grid-template-columns:1fr}}
svg{display:block;width:100%;height:auto}
svg text{font-size:11px;fill:var(--muted)}
.months{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:14px}
.month{border:1px solid var(--line);border-radius:9px;padding:10px}
.month .mt{font-size:12px;font-weight:650;margin-bottom:8px;color:var(--muted)}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.cal .dow{font-size:10px;color:var(--muted);text-align:center;padding-bottom:3px}
.cal .cell{aspect-ratio:1;border-radius:4px;background:#f7f8fa;font-size:10px;display:flex;align-items:center;justify-content:center;color:#b3b8c0;cursor:default;font-variant-numeric:tabular-nums}
.cal .cell.has{color:#8a1c1c;cursor:pointer;font-weight:600}
.cal .cell.hot{color:#fff}
.cal .cell.has:hover{outline:2px solid var(--accent)}
.cal .cell.sel{outline:3px solid #111;outline-offset:1px}
.legend{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted);margin-top:12px}
.legend i{width:14px;height:14px;border-radius:3px;display:inline-block}
.mstats{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px;font-variant-numeric:tabular-nums}
.mstats th,.mstats td{padding:5px 8px;border-bottom:1px solid #f0f1f3;text-align:right}
.mstats th{color:var(--muted);font-weight:600;background:#fafbfc}
.mstats td:first-child,.mstats th:first-child{text-align:left}
.mstats tr:hover td{background:#fafbfc}
.toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
button,select,input[type=search]{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 11px;font-size:13px;color:var(--text);outline:none;font-family:inherit}
button{cursor:pointer}
button:hover{border-color:var(--accent);color:var(--accent)}
button.prim{background:var(--accent);border-color:var(--accent);color:#fff}
button.prim:hover{background:#1d4ed8;color:#fff}
input[type=search]{min-width:210px}
input[type=search]:focus,select:focus{border-color:var(--accent)}
.daytitle{font-size:17px;font-weight:650;margin:0 0 4px}
.daysub{color:var(--muted);font-size:12px}
.count{margin-left:auto;color:var(--muted);font-size:13px}
.ladder{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.ladder span{background:#fff1f0;border:1px solid #ffd9d6;color:var(--up);border-radius:6px;padding:3px 9px;font-size:12px}
.tablecard{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:660px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;white-space:nowrap}
thead th{position:sticky;top:0;background:#fafbfc;border-bottom:1px solid var(--line);text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:9px 11px;z-index:2;cursor:pointer;user-select:none}
thead th:hover{color:var(--accent)}
tbody td{padding:8px 11px;border-bottom:1px solid #f0f1f3;font-size:13px}
tbody tr:hover{background:#fafbfc}
tbody tr.broken{background:#fffdf7}
tbody tr.broken:hover{background:#fff8ea}
.idx{color:var(--muted);width:40px}
.stock b{font-weight:600}.stock small{display:block;color:var(--muted);font-size:11px;letter-spacing:.4px}
.tag{display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:#fff1f0;color:var(--up);border:1px solid #ffd4d1;margin-right:3px}
.tag.br{background:#fff7ed;color:#b45309;border-color:#fed7aa}
.tag.bd{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
.numcell{text-align:right}
.time{font-weight:600}
.empty{padding:38px;text-align:center;color:var(--muted)}
.bars{display:flex;flex-direction:column;gap:7px}
.barrow{display:grid;grid-template-columns:96px 1fr 52px;gap:9px;align-items:center;font-size:12px}
.bartrack{background:var(--chip);border-radius:5px;height:12px;overflow:hidden}
.barfill{height:100%;background:linear-gradient(90deg,#f3a09a,#d92b2b);border-radius:5px}
.barval{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
footer{margin-top:20px;color:var(--muted);font-size:12px;line-height:1.9}
code{background:var(--chip);padding:1px 5px;border-radius:4px;font-size:11px}
.tip{padding:10px 12px;background:#fff7ed;border:1px solid #fde4c4;border-radius:8px;color:#9a5b13;font-size:13px;margin-bottom:14px}
`;

const JS = `
var DATA=JSON.parse(document.getElementById('kpl-year').textContent);
var days=DATA.days, byDay={}; days.forEach(function(d){byDay[d.day]=d;});
var overview=DATA.tradingDays, selected=DATA.to, sortKey='time', sortDir=1, keyword='', kindFilter='', reasonFilter='';

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){if(!v)return '—';var a=Math.abs(v);if(a>=1e8)return (v/1e8).toFixed(2)+'亿';if(a>=1e4)return (v/1e4).toFixed(0)+'万';return String(v);}
function pct(v){return v?Number(v).toFixed(2)+'%':'—';}
function color(v){return v>0?'up':(v<0?'down':'');}

function renderKpis(){
  var totalLimit=0,totalBroken=0,maxDay=null,maxVal=0,maxLadder=0,sealSum=0,n=0;
  days.forEach(function(d){
    totalLimit+=d.stats.limitCount; totalBroken+=d.stats.brokenCount; sealSum+=d.stats.totalSeal; n+=d.stats.limitCount;
    if(d.stats.limitCount>maxVal){maxVal=d.stats.limitCount;maxDay=d.day;}
  });
  overview.forEach(function(o){if(o.ladderHeight>maxLadder)maxLadder=o.ladderHeight;});
  var avg=days.length?(totalLimit/days.length).toFixed(1):'0';
  var items=[
    ['交易日',days.length,'','覆盖 '+DATA.from+' ~ '+DATA.to],
    ['涨停个股',totalLimit,'up','全年累计封板'],
    ['破板个股',totalBroken,'','曾涨停未封住'],
    ['日均涨停',avg,'','按交易日计算'],
    ['单日最多',maxVal,'up',maxDay||'—'],
    ['最高连板',maxLadder,'','取自情绪历史'],
    ['封单合计',money(sealSum),'up','全年累计'],
    ['明细行数',DATA.meta.totalRows,'','涨停 + 破板']
  ];
  document.getElementById('kpis').innerHTML=items.map(function(x){
    return '<div class="card"><div class="label">'+x[0]+'</div><div class="value '+x[2]+'">'+x[1]+'</div><div class="foot">'+x[3]+'</div></div>';
  }).join('');
}

function dayLimit(o){var d=byDay[o.day];return d?d.stats.limitCount:0;}
function dayBroken(o){var d=byDay[o.day];return d?d.stats.brokenCount:0;}

function renderTrend(){
  var W=1200,H=210,pad={l:38,r:38,t:14,b:26},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  var maxV=Math.max(10,Math.max.apply(null,overview.map(dayLimit)));
  var step=iw/Math.max(1,overview.length-1);
  var s='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">';
  for(var g=0;g<=4;g++){
    var y=pad.t+ih*g/4;
    s+='<line x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="#eceef2"/>';
    s+='<text x="4" y="'+(y+4)+'">'+Math.round(maxV*(4-g)/4)+'</text>';
  }
  overview.forEach(function(o,i){
    var v=dayLimit(o),h=v/maxV*ih,x=pad.l+i*step,y=pad.t+ih-h;
    s+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+Math.max(1,step-0.6).toFixed(1)+'" height="'+Math.max(0.5,h).toFixed(1)+'" fill="#e8786f" opacity=".78"><title>'+o.day+' 封住涨停 '+v+' / 破板 '+dayBroken(o)+' / 情绪 '+o.strong+'</title></rect>';
  });
  var pts=overview.map(function(o,i){return (pad.l+i*step).toFixed(1)+','+(pad.t+ih-Math.min(1,o.strong/100)*ih).toFixed(1);}).join(' ');
  s+='<polyline points="'+pts+'" fill="none" stroke="#2563eb" stroke-width="1.6" opacity=".85"/>';
  overview.forEach(function(o,i){
    if(i%30===0||i===overview.length-1) s+='<text x="'+(pad.l+i*step)+'" y="'+(H-6)+'">'+o.day.slice(5)+'</text>';
  });
  s+='<text x="'+(W-pad.r+4)+'" y="'+(pad.t+8)+'" fill="#2563eb">情绪</text></svg>';
  document.getElementById('trend').innerHTML=s;
}

function heatClass(v,max){var r=v/Math.max(1,max);return r>.8?'h5':r>.6?'h4':r>.4?'h3':r>.2?'h2':'h1';}
var HEAT={h1:'#ffe9e7',h2:'#ffc9c4',h3:'#f79b93',h4:'#e85c50',h5:'#c62828'};

function renderCalendar(){
  var groups={},max=Math.max.apply(null,overview.map(dayLimit).concat([1]));
  overview.forEach(function(o){var m=o.day.slice(0,7);(groups[m]=groups[m]||{})[o.day]=o;});
  var html='';
  Object.keys(groups).sort().forEach(function(m){
    html+='<div class="month"><div class="mt">'+m+'</div><div class="cal">';
    ['一','二','三','四','五','六','日'].forEach(function(w){html+='<div class="dow">'+w+'</div>';});
    var first=new Date(m+'-01T00:00:00'),lead=(first.getDay()+6)%7;
    for(var i=0;i<lead;i++) html+='<div class="cell"></div>';
    Object.keys(groups[m]).sort().forEach(function(day){
      var o=groups[m][day],v=dayLimit(o),dn=Number(day.slice(8)),hc=heatClass(v,max);
      html+='<div class="cell has '+(hc==='h4'||hc==='h5'?'hot':'')+'" data-day="'+day+'" style="background:'+HEAT[hc]+'" title="'+day+' 封住涨停 '+v+' / 破板 '+dayBroken(o)+' / 情绪 '+o.strong+'">'+dn+'</div>';
    });
    html+='</div></div>';
  });
  var el=document.getElementById('calendar');
  el.innerHTML=html;
  el.querySelectorAll('.cell.has').forEach(function(c){c.onclick=function(){selected=c.dataset.day;renderDay();};});
}

function renderMonthStats(){
  var g={};
  overview.forEach(function(o){
    var m=o.day.slice(0,7),x=g[m]=g[m]||{sum:0,n:0,max:0,broken:0},v=dayLimit(o);
    x.sum+=v;x.n++;if(v>x.max)x.max=v;
    var d=byDay[o.day];if(d)x.broken+=d.stats.brokenCount;
  });
  var rows=Object.keys(g).sort().map(function(m){var x=g[m];
    return '<tr><td>'+m+'</td><td>'+x.n+'</td><td>'+x.sum+'</td><td>'+(x.sum/x.n).toFixed(1)+'</td><td class="up">'+x.max+'</td><td>'+x.broken+'</td></tr>';
  }).join('');
  document.getElementById('month-stats').innerHTML='<table class="mstats"><thead><tr><th>月份</th><th>交易日</th><th>封住</th><th>日均</th><th>单日最多</th><th>破板</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function renderTopics(){
  var counts={};
  days.forEach(function(d){Object.keys(d.stats.reasonCounts||{}).forEach(function(k){counts[k]=(counts[k]||0)+d.stats.reasonCounts[k];});});
  var arr=Object.keys(counts).map(function(k){return [k,counts[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,20);
  var max=arr.length?arr[0][1]:1;
  document.getElementById('topics').innerHTML='<div class="bars">'+arr.map(function(x){
    return '<div class="barrow"><span>'+esc(x[0])+'</span><div class="bartrack"><div class="barfill" style="width:'+(x[1]/max*100).toFixed(1)+'%"></div></div><span class="barval">'+x[1]+'</span></div>';
  }).join('')+'</div>';
  var sel=document.getElementById('reason-filter');
  arr.forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[0]+' ('+x[1]+')';sel.appendChild(o);});
}

function rowValues(r){
  return [r.code,r.name,r.kind==='limit'?'涨停':'破板',r.time,r.boards,r.reason,r.reasonCount,
    money(r.seal),money(r.maxSeal),money(r.mainNet),r.price?r.price.toFixed(2):'—',pct(r.change),
    money(r.amount),pct(r.amplitude),money(r.floatCap),pct(r.turnover),r.sector,r.tags.join(' ')];
}
var HEAD=['#','股票 / 代码','状态','涨停时间','连板','涨停原因','家数','封单','最大封单','主力净额','价格','涨幅','成交额','振幅','实际流通','换手','板块','标注'];
var SORTKEYS=[null,'name','kind','time','boards','reason','reasonCount','seal','maxSeal','mainNet','price','change','amount','amplitude','floatCap','turnover','sector',null];

function renderDay(){
  var d=byDay[selected];
  document.getElementById('day-select').value=selected;
  document.querySelectorAll('.cell.has').forEach(function(c){c.classList.toggle('sel',c.dataset.day===selected);});
  if(!d){document.getElementById('detail-body').innerHTML='<tr><td colspan="18" class="empty">该交易日无明细数据</td></tr>';return;}
  var o=overview.find(function(x){return x.day===selected;})||{};
  document.getElementById('day-title').textContent=selected+' 涨停表现';
  document.getElementById('day-sub').textContent='涨停 '+d.stats.limitCount+' 家 · 破板 '+d.stats.brokenCount+' 家 · 封单合计 '+money(d.stats.totalSeal)+(o.strong!==undefined?' · 情绪 '+o.strong+' · 最高连板 '+o.ladderHeight:'');
  document.getElementById('ladder').innerHTML=(d.ladder||[]).map(function(v,i){return '<span>'+['一板','二板','三板','四板','更高'][i]+' '+v+'</span>';}).join('')||'<span>梯队无数据</span>';
  renderTable();
}

function renderTable(){
  var d=byDay[selected];if(!d)return;
  var rows=d.rows.filter(function(r){
    if(kindFilter&&r.kind!==kindFilter)return false;
    if(reasonFilter&&r.reason!==reasonFilter)return false;
    if(keyword&&(r.name+r.code+r.reason+r.sector+r.tags.join('')).toLowerCase().indexOf(keyword.toLowerCase())<0)return false;
    return true;
  });
  var key=SORTKEYS[sortKey==='time'?3:Math.max(0,HEAD.indexOf(sortKey))];
  if(sortKey&&['time','seal','maxSeal','mainNet','price','change','amount','amplitude','floatCap','turnover','reasonCount'].indexOf(sortKey)>=0){
    rows=rows.slice().sort(function(a,b){var x=a[sortKey],y=b[sortKey];if(typeof x==='string')return sortDir*x.localeCompare(y);return sortDir*(Number(x)-Number(y));});
  }else{
    rows=rows.slice().sort(function(a,b){if(a.kind!==b.kind)return a.kind==='limit'?-1:1;return (a.time||'99:99').localeCompare(b.time||'99:99')||b.seal-a.seal;});
  }
  document.getElementById('row-count').textContent='显示 '+rows.length+' / '+d.rows.length+' 行';
  if(!rows.length){document.getElementById('detail-body').innerHTML='<tr><td colspan="18" class="empty">无匹配行</td></tr>';return;}
  document.getElementById('detail-body').innerHTML=rows.map(function(r,i){
    var tags=r.tags.map(function(t){return '<span class="tag '+(t==='破板'?'br':(t.indexOf('板')>0?'bd':''))+'">'+esc(t)+'</span>';}).join('');
    var cls=r.kind==='broken'?' class="broken"':'';
    var cells=['<td class="idx">'+(i+1)+'</td>',
      '<td class="stock"><b>'+esc(r.name)+'</b><small>'+esc(r.code)+'</small></td>',
      '<td>'+(r.kind==='limit'?'<span class="tag">涨停</span>':'<span class="tag br">破板</span>')+'</td>',
      '<td class="time">'+(r.time||'—')+'</td>','<td>'+esc(r.boards||'—')+'</td>',
      '<td>'+esc(r.reason||'—')+'</td>','<td>'+(r.reasonCount||'—')+'</td>',
      '<td class="numcell up">'+money(r.seal)+'</td>','<td class="numcell">'+money(r.maxSeal)+'</td>',
      '<td class="numcell '+color(r.mainNet)+'">'+money(r.mainNet)+'</td>',
      '<td class="numcell">'+(r.price?r.price.toFixed(2):'—')+'</td>',
      '<td class="numcell '+color(r.change)+'">'+pct(r.change)+'</td>',
      '<td class="numcell">'+money(r.amount)+'</td>','<td class="numcell">'+pct(r.amplitude)+'</td>',
      '<td class="numcell">'+money(r.floatCap)+'</td>','<td class="numcell">'+pct(r.turnover)+'</td>',
      '<td>'+esc(r.sector||'—')+'</td>','<td>'+tags+'</td>'];
    return '<tr'+cls+'>'+cells.join('')+'</tr>';
  }).join('');
}

function exportCsv(){
  var d=byDay[selected];if(!d)return;
  var lines=[HEAD.join(',')].concat(d.rows.map(function(r){return rowValues(r).map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(',');}));
  var blob=new Blob(['\\ufeff'+lines.join('\\n')],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kpl-'+selected+'.csv';a.click();URL.revokeObjectURL(a.href);
}

function init(){
  var sel=document.getElementById('day-select');
  overview.slice().reverse().forEach(function(o){var x=document.createElement('option');x.value=o.day;x.textContent=o.day+' (封住 '+dayLimit(o)+' / 破板 '+dayBroken(o)+')';sel.appendChild(x);});
  sel.onchange=function(){selected=sel.value;renderDay();};
  document.getElementById('prev-day').onclick=function(){var i=overview.findIndex(function(o){return o.day===selected;});if(i>0){selected=overview[i-1].day;renderDay();}};
  document.getElementById('next-day').onclick=function(){var i=overview.findIndex(function(o){return o.day===selected;});if(i>=0&&i<overview.length-1){selected=overview[i+1].day;renderDay();}};
  document.getElementById('kw').oninput=function(){keyword=this.value;renderTable();};
  document.getElementById('kind-filter').onchange=function(){kindFilter=this.value;renderTable();};
  document.getElementById('reason-filter').onchange=function(){reasonFilter=this.value;renderTable();};
  document.getElementById('sort-by').onchange=function(){sortKey=this.value;renderTable();};
  document.getElementById('sort-dir').onclick=function(){sortDir*=-1;this.textContent=sortDir>0?'↑ 升序':'↓ 降序';renderTable();};
  document.getElementById('export').onclick=exportCsv;
  document.getElementById('detail-head').onclick=function(e){var th=e.target.closest('th');if(!th)return;var k=SORTKEYS[Array.prototype.indexOf.call(this.children,th)];if(k){sortKey=k;renderTable();}};
  document.addEventListener('keydown',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
    if(e.key==='ArrowLeft')document.getElementById('prev-day').click();
    if(e.key==='ArrowRight')document.getElementById('next-day').click();});
  renderKpis();renderTrend();renderMonthStats();renderCalendar();renderTopics();renderDay();
}
init();
`;

export function renderYearHtml(data: YearReview): string {
  const failedNote = data.meta.failed.length
    ? `<div class="tip">有 ${data.meta.failed.length} 个交易日未取到完整明细（已跳过或缓存缺失）：${data.meta.failed.slice(0, 8).join('、')}${data.meta.failed.length > 8 ? ' …' : ''}</div>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开盘啦 · 全年涨停表现复盘 ${data.from} ~ ${data.to}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>开盘啦 · 全年涨停表现复盘</h1>
      <div class="sub">市场情绪 / 涨停表现 / 更多 —— 按交易日回溯，宽屏复盘</div>
    </div>
    <div class="badges">
      <span class="badge">区间 <b>${data.from} ~ ${data.to}</b></span>
      <span class="badge">交易日 <b>${data.meta.collected}/${data.meta.requested}</b></span>
      <span class="badge">明细 <b>${data.meta.totalRows}</b> 行</span>
      <span class="badge">生成 <b>${data.generatedAt.slice(0, 19).replace('T', ' ')}</b></span>
    </div>
  </header>

  ${failedNote}
  <div class="grid" id="kpis"></div>

  <div class="two">
    <section class="panel">
      <h2>封住涨停 / 市场情绪 <small>红柱＝当日封住涨停家数，蓝线＝情绪指标(0-100)，鼠标悬停看当日数值</small></h2>
      <div id="trend"></div>
      <div class="legend">封住涨停 <i style="background:#e8786f"></i> 低 → 高 <i style="background:#c62828"></i> ｜ <span style="color:#2563eb">━ 情绪指标</span></div>
      <h2 style="margin-top:18px">月度统计 <small>按交易日汇总</small></h2>
      <div id="month-stats"></div>
    </section>
    <section class="panel">
      <h2>全年题材 TOP 20 <small>按涨停个股出现次数</small></h2>
      <div id="topics"></div>
    </section>
  </div>

  <section class="panel">
    <h2>交易日历 <small>颜色越深＝当日封住涨停越多；点击任意日期查看明细</small></h2>
    <div class="months" id="calendar"></div>
  </section>

  <section class="panel">
    <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="daytitle" id="day-title">—</div>
        <div class="daysub" id="day-sub">—</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="prev-day">◀ 前一交易日</button>
        <select id="day-select"></select>
        <button id="next-day">后一交易日 ▶</button>
      </div>
    </div>
    <div class="ladder" id="ladder"></div>
    <div class="toolbar">
      <input type="search" id="kw" placeholder="搜索股票 / 代码 / 题材 / 板块">
      <select id="kind-filter"><option value="">全部状态</option><option value="limit">仅涨停</option><option value="broken">仅破板</option></select>
      <select id="reason-filter"><option value="">全部题材</option></select>
      <select id="sort-by">
        <option value="time">按涨停时间</option><option value="seal">按封单</option>
        <option value="maxSeal">按最大封单</option><option value="mainNet">按主力净额</option>
        <option value="amount">按成交额</option><option value="change">按涨幅</option>
        <option value="price">按价格</option><option value="amplitude">按振幅</option>
        <option value="turnover">按换手</option><option value="floatCap">按实际流通</option>
      </select>
      <button id="sort-dir">↑ 升序</button>
      <button id="export">导出当日 CSV</button>
      <span class="count" id="row-count"></span>
    </div>
    <div class="tablecard"><table>
      <thead><tr id="detail-head">${['#', '股票 / 代码', '状态', '涨停时间', '连板', '涨停原因', '家数', '封单', '最大封单', '主力净额', '价格', '涨幅', '成交额', '振幅', '实际流通', '换手', '板块', '标注'].map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody id="detail-body"></tbody>
    </table></div>
  </section>

  <footer>
    数据来源：开盘啦 <code>apphis.kaipanla.com/w1/api/index.php</code> 公开接口（GET + <code>Day</code>，免登录，按交易日回溯）。
    明细接口 <code>DailyLimitPerformance</code> / <code>DailyLimitPerformance2</code> 的字段含义已用 macOS 辅助功能读取 App 实际显示值逐项校准。<br>
    口径：全站「封住」＝明细列表中最终封住涨停的个股，「破板」＝曾涨停但未封住；情绪历史的 <code>ztjs</code>（收盘涨停家数）是另一套统计，本页仅用它提供交易日、情绪指标与最高连板，不参与汇总。<br>
    金额单位元，页面自动换算万/亿；红涨绿跌。本页面仅供个人复盘，数据以 App 实际展示为准。键盘 ← → 可切换交易日。
  </footer>
</div>
<script id="kpl-year" type="application/json">${embed(data)}</script>
<script>${JS}</script>
</body>
</html>`;
}
