// 模型体检（IC 审计）v2.1 —— 全年口径（已同步 v4.0 模型：rsPen 不入总分、L2 收盘态权重 8；rsPen 仍单独报告作诊断）
const MODEL_VERSION = "4.0"; // 审计口径对应的模型版本（validate-repo.mjs 校验三处一致）
// 版本边界识别：history.json 记录若带 mv 字段即为该模型版本实录；无 mv 且带 bf:1 = 3.x 回填；无 mv 无 bf = 3.x 实录
// 用与页面/快照同口径的模型按历史日重算分层评分，检验各层与未来收益的关系
// v2 变化：K线拉 260 根（覆盖 2026 全年）、美股/恒科改在线拉取、新增 分月IC / 分行情(regime)IC / 自身历史分位测试
// 运行：node scripts/audit.mjs  （本机，需可达 quotes.sina.cn / web.ifzq.gtimg.cn / query1.finance.yahoo.com）
// 输出：控制台 + _audit_report.txt（临时，看完可删）
// ⚠️ 已知偏差：池子为 2026-08 筛选（幸存者偏差）；corr90 基线为 8 月口径（前视）；L2 近似=纳指T-1+恒科T
import fs from "node:fs";

const DATALEN = 260;
const YEAR_FROM = "2026-01-01";
const html = fs.readFileSync("index.html", "utf8");
const HOME = "bj920021";
const IDX_CANDS = ["sh000001","sz399001","sz399006","sh000688","sz399971","bj899050"];
const PEERS = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*corr90: ([\d.]+)/g)].map(m=>({sym:m[1],corr90:+m[2]}));
const WATCH = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*tag:/g)].map(m=>m[1]).filter(s=>!IDX_CANDS.includes(s));
const STOCKS = [...new Set([HOME, ...PEERS.map(p=>p.sym), ...WATCH])];
const ALL_K = [...new Set([...STOCKS, ...IDX_CANDS])];

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const lin = (x, lo, hi) => Number.isFinite(x) ? Math.max(0, Math.min(100, (x-lo)/(hi-lo)*100)) : null;
const ma = (c,n) => c.length>=n ? c.slice(-n).reduce((s,x)=>s+x,0)/n : null;
function corr(a,b){const n=Math.min(a.length,b.length);if(n<8)return null;const A=a.slice(-n),B=b.slice(-n);const ma_=A.reduce((s,x)=>s+x,0)/n,mb=B.reduce((s,x)=>s+x,0)/n;let cov=0,va=0,vb=0;for(let i=0;i<n;i++){const da=A[i]-ma_,db=B[i]-mb;cov+=da*db;va+=da*da;vb+=db*db;}return(va===0||vb===0)?null:cov/Math.sqrt(va*vb);}
const benchFor = sym => sym.startsWith("bj")?"bj899050":sym.startsWith("sh688")?"sh000688":sym.startsWith("sz3")?"sz399006":sym.startsWith("sz")?"sz399001":"sh000001";
const limitFor = sym => IDX_CANDS.includes(sym)?10:sym.startsWith("bj")?30:(sym.startsWith("sh688")||sym.startsWith("sz30"))?20:10;
const layerScore = rows => { const v=rows.filter(r=>r&&Number.isFinite(r.score)); if(!v.length)return null; const w=v.reduce((s,r)=>s+r.w,0); return v.reduce((s,r)=>s+r.score*r.w,0)/w; };

async function fetchSina(sym){
  try{
    const r = await fetch(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=${DATALEN}`, {...UA, signal:AbortSignal.timeout(20000)});
    const j = await r.json();
    if(Array.isArray(j)&&j.length>10) return j.map(b=>({day:b.day,high:+b.high,low:+b.low,close:+b.close,vol:+b.volume}));
  }catch(e){}
  return null;
}
const K = {};
for(let i=0;i<ALL_K.length;i+=4){
  await Promise.all(ALL_K.slice(i,i+4).map(async s=>{const b=await fetchSina(s);if(b)K[s]=b;}));
  await sleep(350);
}
console.log("CN klines:",Object.keys(K).length,"/",ALL_K.length, "HOME bars:",K[HOME]?.length);

// 恒生科技（ifzq，300 根）
let HK=null;
try{
  const r=await fetch("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hkHSTECH,day,,,300,",{...UA,signal:AbortSignal.timeout(20000)});
  const j=await r.json(); const d=j?.data?.hkHSTECH?.day;
  if(Array.isArray(d)) HK=d.map(x=>({day:x[0],close:+x[2]}));
}catch(e){}
console.log("HK bars:",HK?HK.length:0);

// 纳斯达克（Yahoo，2 年）
let usBars=[];
try{
  const r=await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?range=2y&interval=1d",{...UA,signal:AbortSignal.timeout(20000)});
  const j=await r.json(); const res=j?.chart?.result?.[0];
  const ts=res?.timestamp||[], cl=res?.indicators?.quote?.[0]?.close||[];
  usBars=ts.map((t,i)=>({day:new Date(t*1000).toISOString().slice(0,10),close:cl[i]})).filter(x=>Number.isFinite(x.close));
}catch(e){}
console.log("US bars:",usBars.length);

function pctMap(bars){const m=new Map();for(let i=1;i<bars.length;i++)if(bars[i-1].close)m.set(bars[i].day,(bars[i].close/bars[i-1].close-1)*100);return m;}
const PCT={};for(const s of ALL_K)if(K[s])PCT[s]=pctMap(K[s]);
const HKP=HK?pctMap(HK):new Map();
const USP=pctMap(usBars);const usDates=usBars.map(b=>b.day);
function usPrevPct(d){let lo=0,hi=usDates.length-1,best=null;while(lo<=hi){const mid=(lo+hi)>>1;if(usDates[mid]<d){best=usDates[mid];lo=mid+1;}else hi=mid-1;}return best?USP.get(best)??null:null;}
const idxAt=(sym,d)=>{const p=PCT[sym];return p&&p.has(d)?p.get(d):null;};
// day -> index 预计算（提速）
const DIDX={};for(const s of ALL_K)if(K[s]){const m=new Map();K[s].forEach((b,i)=>m.set(b.day,i));DIDX[s]=m;}

function scoreDay(sym,d){
  const bars=K[sym]; const i=DIDX[sym]?.get(d);
  if(i===undefined||i<30) return null;
  const upto=bars.slice(0,i+1); const closes=upto.map(b=>b.close); const p=closes[closes.length-1];
  const myPct=PCT[sym].get(d); if(!Number.isFinite(myPct))return null;
  const B=benchFor(sym), bPct=idxAt(B,d);
  const sh=idxAt("sh000001",d), cyb=idxAt("sz399006",d);
  const spread=B==="sh000001"?idxAt("sz399001",d):sh;
  const l1=layerScore([
    Number.isFinite(bPct)&&{score:lin(bPct,-2,2),w:40},
    B!=="sh000001"&&Number.isFinite(sh)&&{score:lin(sh,-1.5,1.5),w:25},
    B==="sh000001"&&Number.isFinite(idxAt("sz399001",d))&&{score:lin(idxAt("sz399001",d),-1.5,1.5),w:25},
    B!=="sz399006"&&Number.isFinite(cyb)&&{score:lin(cyb,-2.5,2.5),w:15},
    Number.isFinite(bPct)&&Number.isFinite(spread)&&{score:lin(bPct-spread,-1.5,1.5),w:20}
  ].filter(Boolean));
  const us=usPrevPct(d), hk=HKP.get(d);
  const l2=layerScore([
    Number.isFinite(us)&&{score:lin(us,-2,2),w:30},
    Number.isFinite(hk)&&{score:lin(hk,-2.5,2.5),w:25}
  ].filter(Boolean));
  let l3=null;
  if(sym===HOME){
    let ws=0,ps=0,up=0,ok=0;
    for(const pr of PEERS){const pp=idxAt(pr.sym,d);if(Number.isFinite(pp)){ws+=pr.corr90;ps+=pr.corr90*pp*10/limitFor(pr.sym);ok++;if(pp>0)up++;}}
    const rows=[];
    if(ok)rows.push({score:lin(ps/ws,-3,3),w:45},{score:up/ok*100,w:15});
    if(Number.isFinite(idxAt("sz399971",d)))rows.push({score:lin(idxAt("sz399971",d),-2.5,2.5),w:20});
    if(Number.isFinite(idxAt("sh000688",d)))rows.push({score:lin(idxAt("sh000688",d),-2.5,2.5),w:20});
    l3=layerScore(rows);
  }else{
    const myRets=[];for(let k=Math.max(1,i-29);k<=i;k++)myRets.push(upto[k].close/upto[k-1].close-1);
    const cands=[];
    for(const o of [...new Set([HOME,...STOCKS,...IDX_CANDS])]){
      if(o===sym||!K[o])continue;
      const oi=DIDX[o].get(d);
      if(oi===undefined||oi<20)continue;
      const ob=K[o];
      const oRets=[];for(let k=Math.max(1,oi-29);k<=oi;k++)oRets.push(ob[k].close/ob[k-1].close-1);
      if(Math.min(myRets.length,oRets.length)<20)continue;
      const c=corr(myRets,oRets);
      if(c!==null&&c>=0.30&&Number.isFinite(PCT[o]?.get(d)))cands.push({sym:o,c});
    }
    cands.sort((a,b)=>b.c-a.c);
    const top=cands.slice(0,5);
    if(top.length){
      let ws=0,ps=0,up=0;
      for(const t of top){const tp=PCT[t.sym].get(d);ws+=t.c;ps+=t.c*tp*10/limitFor(t.sym);if(tp>0)up++;}
      l3=layerScore([{score:lin(ps/ws,-3,3),w:70},{score:up/top.length*100,w:30}]);
    }
  }
  const m5=ma(closes,5),m10=ma(closes,10),m20=ma(closes,20);
  const rows4=[{score:lin((p/m20-1)*100,-6,6),w:20}];
  let maS=10;
  if(p>m5&&m5>m10&&m10>m20)maS=100;else if(p>m5&&m5>m10)maS=75;else if(p>m5)maS=55;else if(p>m20)maS=40;
  rows4.push({score:maS,w:20});
  if(Number.isFinite(bPct))rows4.push({score:lin(myPct-bPct,-3,3),w:20});
  const bb=K[B],bi=bb?DIDX[B].get(d):undefined;
  if(bi>=5&&i>=5){
    const rs5=((closes[closes.length-1]/closes[closes.length-6]-1)-(bb[bi].close/bb[bi-5].close-1))*100;
    rows4.push({score:lin(rs5,-6,6),w:20});
  }
  const prev20=upto.slice(0,-1).slice(-20);
  const h20=Math.max(...prev20.map(b=>b.high)),l20=Math.min(...prev20.map(b=>b.low));
  if(h20>l20)rows4.push({score:Math.max(0,Math.min(100,(p-l20)/(h20-l20)*100)),w:20});
  const vols=upto.slice(0,-1).slice(-5).map(b=>b.vol);
  const avg5=vols.length?vols.reduce((s,x)=>s+x,0)/vols.length:null;
  if(avg5&&upto[upto.length-1].vol){
    const vr=upto[upto.length-1].vol/avg5;
    rows4.push({score:myPct>=0?lin(vr,0.6,2.5):100-lin(vr,0.6,2.5),w:20});
  }
  const l4=layerScore(rows4);
  const parts=[[l1,20],[l2,8],[l3,25],[l4,40]]; // v4.0：L2 收盘态权重 8
  let w=0,s=0;
  for(const[v,wt]of parts)if(Number.isFinite(v)){w+=wt;s+=v*wt;}
  if(!w)return null;
  const raw=s/w;
  let rsPen=0; // v4.0 起不入总分，仅作诊断输出
  if(Number.isFinite(bPct)){const rs=myPct-bPct;if(rs<-1.5)rsPen=Math.min(15,(Math.abs(rs)-1.5)*10);}
  const lim=limitFor(sym);
  const r2=i>=2?(p/closes[closes.length-3]-1)*100:null;
  const r5=i>=5?(p/closes[closes.length-6]-1)*100:null;
  const p2=r2!==null?Math.max(0,(r2-1.5*lim)/lim*30):0;
  const p5=r5!==null?Math.max(0,(r5-2*lim)/lim*20):0;
  const ohPen=Math.min(20,Math.max(p2,p5));
  return {d,l1,l2,l3,l4,raw,rsPen,ohPen,score:Math.max(0,raw-ohPen),p,pct:myPct};
}

/* ===== regime 标注（按创业板指：MA20 上/下 + 斜率） ===== */
const REG=new Map();
{
  const bars=K["sz399006"]||[];
  const closes=bars.map(b=>b.close);
  for(let i=25;i<bars.length;i++){
    const c=closes[i];
    const m20=ma(closes.slice(0,i+1),20), m20p=ma(closes.slice(0,i-4),20);
    let reg="chop";
    if(c>m20&&m20>m20p)reg="up"; else if(c<m20&&m20<m20p)reg="down";
    REG.set(bars[i].day,reg);
  }
}

/* ===== 全样本计算 ===== */
const rowsBySym={};
for(const sym of STOCKS){
  if(!K[sym])continue;
  const out=[];
  const bars=K[sym];
  for(let i=0;i<bars.length;i++){
    const d=bars[i].day;
    if(d<YEAR_FROM)continue;
    const r=scoreDay(sym,d);
    if(r){
      for(const h of [1,3,5]) r["fwd"+h]=(i+h<bars.length)?(bars[i+h].close/bars[i].close-1)*100:null;
      out.push(r);
    }
  }
  for(let j=0;j<out.length;j++) out[j].ds3=j>=3?out[j].score-out[j-3].score:null;
  rowsBySym[sym]=out;
}
const byDay={};
for(const [sym,rows] of Object.entries(rowsBySym))
  for(const r of rows){ (byDay[r.d]=byDay[r.d]||[]).push({sym,...r}); }
const days=Object.keys(byDay).sort();

/* ===== 工具 ===== */
function ranks(a){const idx=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);const rk=new Array(a.length);let i=0;while(i<idx.length){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;const avg=(i+j)/2+1;for(let k=i;k<=j;k++)rk[idx[k][1]]=avg;i=j+1;}return rk;}
function spearman(x,y){const pairs=x.map((v,i)=>[v,y[i]]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));if(pairs.length<8)return null;const rx=ranks(pairs.map(p=>p[0])),ry=ranks(pairs.map(p=>p[1]));return corr(rx,ry);}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const std=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1));};
function icSeries(pr,h,filterFn){
  const out=[];
  for(const d of days){
    if(filterFn&&!filterFn(d))continue;
    const rows=byDay[d];
    const ic=spearman(rows.map(r=>r[pr]),rows.map(r=>r["fwd"+h]));
    if(ic!==null)out.push({d,ic});
  }
  return out;
}
const fmtIC=arr=>{if(arr.length<8)return `n=${arr.length} 不足`;const v=arr.map(x=>x.ic);const m=mean(v),t=m/(std(v)/Math.sqrt(v.length));return `meanIC=${m.toFixed(3)} t=${t.toFixed(2)} n=${v.length} pos%=${(v.filter(x=>x>0).length/v.length*100).toFixed(0)}%`;};

/* ===== 报告 ===== */
let rpt="=== MODEL AUDIT v2 (2026 YTD) ===\n";
rpt+=`symbols=${Object.keys(rowsBySym).length} days=${days.length} (${days[0]} .. ${days[days.length-1]})\n`;
rpt+=`obs=${days.reduce((s,d)=>s+byDay[d].length,0)}\n`;

rpt+="\n--- A. 全年横截面 IC ---\n";
for(const h of [1,3,5]){
  rpt+=`fwd${h}:\n`;
  for(const pr of ["score","l3","l4","ds3","pct"]) rpt+=`  ${pr.padEnd(5)}: ${fmtIC(icSeries(pr,h))}\n`;
}

rpt+="\n--- B. 分月 IC (fwd1) ---\n";
const months=[...new Set(days.map(d=>d.slice(0,7)))].sort();
rpt+="month    | score        | l3           | l4\n";
for(const m of months){
  const f=d=>d.startsWith(m);
  const s=icSeries("score",1,f),a=icSeries("l3",1,f),b=icSeries("l4",1,f);
  const g=arr=>arr.length<5?`n=${arr.length}`:`${mean(arr.map(x=>x.ic)).toFixed(3)}(${arr.length})`;
  rpt+=`${m}  | ${g(s).padEnd(12)} | ${g(a).padEnd(12)} | ${g(b)}\n`;
}

rpt+="\n--- C. 分行情(regime, 创业板MA20口径) IC (fwd1) ---\n";
const regDays={up:0,down:0,chop:0};days.forEach(d=>regDays[REG.get(d)||"chop"]++);
rpt+=`regime days: up=${regDays.up} down=${regDays.down} chop=${regDays.chop}\n`;
for(const reg of ["up","down","chop"]){
  const f=d=>(REG.get(d)||"chop")===reg;
  rpt+=`[${reg}]\n`;
  for(const pr of ["score","l3","l4","pct"]) rpt+=`  ${pr.padEnd(5)}: ${fmtIC(icSeries(pr,1,f))}\n`;
}

rpt+="\n--- D. 五分组 fwd1 + Top-Bottom 息差（全年） ---\n";
{
  const qsum=[[],[],[],[],[]];const spr=[];
  for(const d of days){
    const rows=byDay[d].filter(r=>Number.isFinite(r.fwd1)).sort((a,b)=>a.score-b.score);
    if(rows.length<15)continue;
    const n=rows.length;
    for(let q=0;q<5;q++){const lo=Math.floor(q*n/5),hi=Math.floor((q+1)*n/5);qsum[q].push(mean(rows.slice(lo,hi).map(r=>r.fwd1)));}
    spr.push(mean(rows.slice(-5).map(r=>r.fwd1))-mean(rows.slice(0,5).map(r=>r.fwd1)));
  }
  for(let q=0;q<5;q++)rpt+=`Q${q+1}: ${mean(qsum[q]).toFixed(3)}%/d\n`;
  rpt+=`Top5-Bottom5: ${mean(spr).toFixed(3)}%/d (t=${(mean(spr)/(std(spr)/Math.sqrt(spr.length))).toFixed(2)}, n=${spr.length})\n`;
}

rpt+="\n--- E. 惩罚项有效性（全年） ---\n";
for(const [name,fld,thr] of [["overheat(ohPen>3)","ohPen",3],["rs(rsPen>3)","rsPen",3]]){
  for(const h of [1,3]){
    const pen=[],rest=[];
    for(const d of days)for(const r of byDay[d]){
      if(!Number.isFinite(r["fwd"+h]))continue;
      (r[fld]>thr?pen:rest).push(r["fwd"+h]);
    }
    rpt+=`${name} fwd${h}: penalized(n=${pen.length}) mean=${pen.length?mean(pen).toFixed(2):"-"}% vs others(n=${rest.length}) mean=${mean(rest).toFixed(2)}%\n`;
  }
}

rpt+="\n--- F. L1/L2 池均时序（全年） ---\n";
for(const pr of ["l1","l2"]){
  const xs=[],ys=[];
  for(const d of days){
    const rows=byDay[d].filter(r=>Number.isFinite(r[pr])&&Number.isFinite(r.fwd1));
    if(rows.length<15)continue;
    xs.push(mean(rows.map(r=>r[pr])));ys.push(mean(rows.map(r=>r.fwd1)));
  }
  rpt+=`${pr} vs next-day pool-mean: pearson=${corr(xs,ys)?.toFixed(3)} (n=${xs.length})\n`;
}

rpt+="\n--- G. 自身历史分位测试（评分相对自己60日历史的 z 分 → fwd1，池化） ---\n";
{
  const hi=[],lo=[],mid=[];
  for(const [sym,rows] of Object.entries(rowsBySym)){
    for(let j=0;j<rows.length;j++){
      if(!Number.isFinite(rows[j].fwd1))continue;
      const win=rows.slice(Math.max(0,j-59),j).map(r=>r.score);
      if(win.length<30)continue;
      const m=mean(win),sd=std(win);
      if(!sd)continue;
      const z=(rows[j].score-m)/sd;
      (z>1?hi:z<-1?lo:mid).push(rows[j].fwd1);
    }
  }
  rpt+=`z>+1(状态显著强于自身常态): n=${hi.length} meanFwd1=${hi.length?mean(hi).toFixed(2):"-"}%\n`;
  rpt+=`z<-1(显著弱于常态):        n=${lo.length} meanFwd1=${lo.length?mean(lo).toFixed(2):"-"}%\n`;
  rpt+=`中间:                      n=${mid.length} meanFwd1=${mid.length?mean(mid).toFixed(2):"-"}%\n`;
}

fs.writeFileSync("_audit_report.txt",rpt,"utf8");
console.log(rpt);
