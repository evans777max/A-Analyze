// temp: MODEL AUDIT — layer-level IC / bucket / penalty analysis on ~60d history
// 复用 backfill.mjs 的同口径引擎，改造为输出 L1-L4 分层分 + 罚分，然后做:
//  A) 横截面 Spearman IC（score/L3/L4/Δscore/当日pct 对 fwd 1/3/5d 收益）
//  B) 五分组收益 + Top5-Bottom5 息差
//  C) 过热惩罚有效性  D) L1/L2 时序检验  E) 与 history.json 的 sanity 比对
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const HOME = "bj920021";
const IDX_CANDS = ["sh000001","sz399001","sz399006","sh000688","sz399971","bj899050"];
const PEERS = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*corr90: ([\d.]+)/g)].map(m=>({sym:m[1],corr90:+m[2]}));
const WATCH = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*tag:/g)].map(m=>m[1]).filter(s=>!IDX_CANDS.includes(s));
const STOCKS = [...new Set([HOME, ...PEERS.map(p=>p.sym), ...WATCH])];
const ALL_K = [...new Set([...STOCKS, ...IDX_CANDS])];

const US_RAW = "2026-06-01,27086.81;2026-06-02,27093.90;2026-06-03,26853.98;2026-06-04,26830.96;2026-06-05,25709.43;2026-06-08,25929.66;2026-06-09,25678.82;2026-06-10,25169.50;2026-06-11,25809.66;2026-06-12,25888.84;2026-06-15,26683.94;2026-06-16,26376.34;2026-06-17,26021.66;2026-06-18,26517.93;2026-06-22,26166.60;2026-06-23,25587.04;2026-06-24,25476.64;2026-06-25,25358.60;2026-06-26,25297.62;2026-06-29,25820.14;2026-06-30,26213.72;2026-07-01,26040.03;2026-07-02,25832.67;2026-07-06,26121.16;2026-07-07,25818.69;2026-07-08,25870.65;2026-07-09,26206.89;2026-07-10,26281.61;2026-07-13,25873.18;2026-07-14,26107.01;2026-07-15,26269.23;2026-07-16,25881.95;2026-07-17,25520.24;2026-07-20,25508.07;2026-07-21,25837.21;2026-07-22,25690.90;2026-07-23,25137.69;2026-07-24,24975.82;2026-07-27,24932.08;2026-07-28,24876.91;2026-07-29,24442.94;2026-07-30,25122.18;2026-07-31,25373.85;2026-08-03,25913.90;2026-08-04,26584.99;2026-08-05,26363.44;2026-08-06,26348.35;2026-08-07,26690.62";

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
    const r = await fetch(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=90`, {...UA, signal:AbortSignal.timeout(15000)});
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
console.log("klines:",Object.keys(K).length,"/",ALL_K.length);
let HK=null;
try{
  const r=await fetch("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hkHSTECH,day,,,90,",{...UA,signal:AbortSignal.timeout(15000)});
  const j=await r.json(); const d=j?.data?.hkHSTECH?.day;
  if(Array.isArray(d)) HK=d.map(x=>({day:x[0],close:+x[2]}));
}catch(e){}

function pctMap(bars){const m=new Map();for(let i=1;i<bars.length;i++)if(bars[i-1].close)m.set(bars[i].day,(bars[i].close/bars[i-1].close-1)*100);return m;}
const PCT={};for(const s of ALL_K)if(K[s])PCT[s]=pctMap(K[s]);
const HKP=HK?pctMap(HK):new Map();
const usBars=US_RAW.split(";").map(x=>{const[d,c]=x.split(",");return{day:d,close:+c};});
const USP=pctMap(usBars);const usDates=usBars.map(b=>b.day);
function usPrevPct(d){let best=null;for(const ud of usDates){if(ud<d)best=ud;else break;}return best?USP.get(best)??null:null;}
const idxAt=(sym,d)=>{const p=PCT[sym];return p&&p.has(d)?p.get(d):null;};

// —— 与 backfill 同口径，但返回分层明细 ——
function scoreDay(sym,d){
  const bars=K[sym]; const i=bars.findIndex(b=>b.day===d);
  if(i<30) return null;
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
      const ob=K[o],oi=ob.findIndex(b=>b.day===d);
      if(oi<20)continue;
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
  const bb=K[B],bi=bb?bb.findIndex(x=>x.day===d):-1;
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
  const parts=[[l1,20],[l2,15],[l3,25],[l4,40]];
  let w=0,s=0;
  for(const[v,wt]of parts)if(Number.isFinite(v)){w+=wt;s+=v*wt;}
  if(!w)return null;
  const raw=s/w;
  let rsPen=0;
  if(Number.isFinite(bPct)){const rs=myPct-bPct;if(rs<-1.5)rsPen=Math.min(15,(Math.abs(rs)-1.5)*10);}
  const lim=limitFor(sym);
  const r2=i>=2?(p/closes[closes.length-3]-1)*100:null;
  const r5=i>=5?(p/closes[closes.length-6]-1)*100:null;
  const p2=r2!==null?Math.max(0,(r2-1.5*lim)/lim*30):0;
  const p5=r5!==null?Math.max(0,(r5-2*lim)/lim*20):0;
  const ohPen=Math.min(20,Math.max(p2,p5));
  return {d,l1,l2,l3,l4,raw,rsPen,ohPen,score:Math.max(0,raw-rsPen-ohPen),p,pct:myPct};
}

/* ============ 计算全样本 ============ */
const rowsBySym={};
for(const sym of STOCKS){
  if(!K[sym])continue;
  const out=[];
  for(let i=0;i<K[sym].length;i++){
    const r=scoreDay(sym,K[sym][i].day);
    if(r){
      // forward returns
      const bars=K[sym];
      for(const h of [1,3,5]){
        r["fwd"+h]=(i+h<bars.length)?(bars[i+h].close/bars[i].close-1)*100:null;
      }
      out.push(r);
    }
  }
  // Δscore 3d
  for(let j=0;j<out.length;j++) out[j].ds3=j>=3?out[j].score-out[j-3].score:null;
  rowsBySym[sym]=out;
}

// 组织成按日横截面
const byDay={};
for(const [sym,rows] of Object.entries(rowsBySym))
  for(const r of rows){ (byDay[r.d]=byDay[r.d]||[]).push({sym,...r}); }
const days=Object.keys(byDay).sort();

/* ============ 工具:Spearman ============ */
function ranks(a){
  const idx=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);
  const rk=new Array(a.length);
  let i=0;
  while(i<idx.length){
    let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;
    const avg=(i+j)/2+1;
    for(let k=i;k<=j;k++)rk[idx[k][1]]=avg;
    i=j+1;
  }
  return rk;
}
function spearman(x,y){
  const pairs=x.map((v,i)=>[v,y[i]]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(pairs.length<8)return null;
  const rx=ranks(pairs.map(p=>p[0])),ry=ranks(pairs.map(p=>p[1]));
  return corr(rx,ry);
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const std=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1));};

/* ============ A. 横截面 IC ============ */
let rpt="=== MODEL AUDIT ===\n";
rpt+=`symbols: ${Object.keys(rowsBySym).length}, days: ${days.length} (${days[0]} .. ${days[days.length-1]})\n`;
const preds=["score","raw","l3","l4","ds3","pct"];
for(const h of [1,3,5]){
  rpt+=`\n--- cross-sectional Spearman IC vs fwd${h} ---\n`;
  for(const pr of preds){
    const ics=[];
    for(const d of days){
      const rows=byDay[d];
      const ic=spearman(rows.map(r=>r[pr]),rows.map(r=>r["fwd"+h]));
      if(ic!==null)ics.push(ic);
    }
    if(ics.length<10){rpt+=`${pr}: insufficient (${ics.length} days)\n`;continue;}
    const m=mean(ics),sd=std(ics),t=m/(sd/Math.sqrt(ics.length));
    rpt+=`${pr.padEnd(6)}: meanIC=${m.toFixed(3)} t=${t.toFixed(2)} days=${ics.length} pos%=${(ics.filter(x=>x>0).length/ics.length*100).toFixed(0)}%\n`;
  }
}

/* ============ B. 五分组 + Top/Bottom ============ */
rpt+=`\n--- quintile mean fwd1 (by score, cross-sectional) ---\n`;
const qsum=[[],[],[],[],[]];
const spread=[];
for(const d of days){
  const rows=byDay[d].filter(r=>Number.isFinite(r.fwd1)).sort((a,b)=>a.score-b.score);
  if(rows.length<15)continue;
  const n=rows.length;
  for(let q=0;q<5;q++){
    const lo=Math.floor(q*n/5),hi=Math.floor((q+1)*n/5);
    qsum[q].push(mean(rows.slice(lo,hi).map(r=>r.fwd1)));
  }
  const k=5;
  spread.push(mean(rows.slice(-k).map(r=>r.fwd1))-mean(rows.slice(0,k).map(r=>r.fwd1)));
}
for(let q=0;q<5;q++)rpt+=`Q${q+1}${q===0?"(低分)":q===4?"(高分)":""}: ${mean(qsum[q]).toFixed(3)}%/日\n`;
rpt+=`Top5-Bottom5 日均息差: ${mean(spread).toFixed(3)}% (t=${(mean(spread)/(std(spread)/Math.sqrt(spread.length))).toFixed(2)}, days=${spread.length}, pos%=${(spread.filter(x=>x>0).length/spread.length*100).toFixed(0)}%)\n`;

/* ============ C. 过热惩罚有效性 ============ */
rpt+=`\n--- overheat penalty (ohPen>3) forward returns vs pool ---\n`;
for(const h of [1,3,5]){
  const pen=[],rest=[];
  for(const d of days)for(const r of byDay[d]){
    if(!Number.isFinite(r["fwd"+h]))continue;
    (r.ohPen>3?pen:rest).push(r["fwd"+h]);
  }
  if(pen.length>5)rpt+=`fwd${h}: penalized(n=${pen.length}) mean=${mean(pen).toFixed(2)}% vs others(n=${rest.length}) mean=${mean(rest).toFixed(2)}%\n`;
  else rpt+=`fwd${h}: penalized n=${pen.length} too few\n`;
}
/* rsPen 检查 */
rpt+=`--- rs penalty (rsPen>3) ---\n`;
{
  const pen=[],rest=[];
  for(const d of days)for(const r of byDay[d]){
    if(!Number.isFinite(r.fwd3))continue;
    (r.rsPen>3?pen:rest).push(r.fwd3);
  }
  rpt+=`fwd3: rs-penalized(n=${pen.length}) mean=${pen.length?mean(pen).toFixed(2):"-"}% vs others mean=${mean(rest).toFixed(2)}%\n`;
}

/* ============ D. L1/L2 时序检验(对池均值次日收益) ============ */
rpt+=`\n--- time-series check: layer level vs next-day POOL MEAN return ---\n`;
for(const pr of ["l1","l2"]){
  const xs=[],ys=[];
  for(const d of days){
    const rows=byDay[d].filter(r=>Number.isFinite(r[pr])&&Number.isFinite(r.fwd1));
    if(rows.length<15)continue;
    xs.push(mean(rows.map(r=>r[pr])));
    ys.push(mean(rows.map(r=>r.fwd1)));
  }
  const c=corr(xs,ys);
  rpt+=`${pr}(pool-avg) vs next-day pool-mean-ret: pearson=${c===null?"-":c.toFixed(3)} (n=${xs.length})\n`;
}

/* ============ E. sanity vs history.json ============ */
const hist=JSON.parse(fs.readFileSync("data/history.json","utf8"));
let diffs=[],nchk=0;
for(const [sym,rows] of Object.entries(rowsBySym)){
  const hrec=Object.fromEntries((hist[sym]||[]).map(r=>[r.d,r]));
  for(const r of rows){
    const h=hrec[r.d];
    if(h&&h.bf){diffs.push(Math.abs(h.s-r.score));nchk++;}
  }
}
rpt+=`\n--- sanity vs history.json (bf records) ---\nchecked=${nchk} meanAbsDiff=${diffs.length?mean(diffs).toFixed(2):"-"} maxDiff=${diffs.length?Math.max(...diffs).toFixed(2):"-"}\n`;

/* ============ F. 评分斜率 vs 水平:直接对比 ============ */
rpt+=`\n--- slope(ds3) vs level(score): which ranks better? see IC table above ---\n`;

fs.writeFileSync("C:/Ev/_audit_out.txt",rpt,"utf8");
console.log(rpt);
