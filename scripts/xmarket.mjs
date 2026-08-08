// 跨市场传导审计（2026 全年）：美/日/韩 ↔ A股 因子关系
// A. 隔夜美股→A股当日（跳空 vs 日内 vs 收盘，分指数）  B. 耦合度分月演变（验证 O4 解耦叙事）
// C. 美股大涨/大跌夜的不对称反应  D. 日韩：同日并发 + 前日预测 + A股→次日日韩
// E. 个股锚传导：NVDA/MU/AMD/TSM 隔夜 → 对应板块篮子当日（全年 + 分段，验证"传导弱化"）
import fs from "node:fs";

const CN_IDX = [["sh000001","上证"],["sz399006","创业板"],["sh000688","科创50"],["bj899050","北证50"]];
const BASKETS = {
  "光模块":["sz300308","sz300502"], "AI芯片":["sh688256","sh688041"], "存储":["sh688008"],
  "代工":["sh688981"], "服务器":["sh603019","sz000977","sh601138"], "IDC":["sh603881","sz300442","sz300383"]
};
const ANCHOR_MAP = { NVDA:["光模块","服务器","IDC","AI芯片"], MU:["存储"], AMD:["AI芯片"], TSM:["代工"] };
const CN_ALL = [...CN_IDX.map(x=>x[0]), ...new Set(Object.values(BASKETS).flat())];

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function fetchSina(sym){
  try{
    const r = await fetch(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=260`, {...UA, signal:AbortSignal.timeout(20000)});
    const j = await r.json();
    if(Array.isArray(j)&&j.length>10) return j.map(b=>({day:b.day,open:+b.open,close:+b.close}));
  }catch(e){}
  return null;
}
async function fetchYahoo(sym){
  try{
    const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`,{...UA,signal:AbortSignal.timeout(20000)});
    const j=await r.json(); const res=j?.chart?.result?.[0];
    const ts=res?.timestamp||[], cl=res?.indicators?.quote?.[0]?.close||[];
    return ts.map((t,i)=>({day:new Date(t*1000).toISOString().slice(0,10),close:cl[i]})).filter(x=>Number.isFinite(x.close));
  }catch(e){ return []; }
}

const CN={};
for(let i=0;i<CN_ALL.length;i+=4){
  await Promise.all(CN_ALL.slice(i,i+4).map(async s=>{const b=await fetchSina(s);if(b)CN[s]=b;}));
  await sleep(350);
}
console.log("CN:",Object.keys(CN).length,"/",CN_ALL.length);
const Y={};
for(const [sym,key] of [["^IXIC","IXIC"],["^GSPC","GSPC"],["^N225","N225"],["^KS11","KS11"],["NVDA","NVDA"],["MU","MU"],["AMD","AMD"],["TSM","TSM"]]){
  Y[key]=await fetchYahoo(sym);
  await sleep(300);
}
console.log("Yahoo:",Object.entries(Y).map(([k,v])=>k+"="+v.length).join(" "));

const pmap = bars => {const m=new Map();for(let i=1;i<bars.length;i++)if(bars[i-1].close)m.set(bars[i].day,(bars[i].close/bars[i-1].close-1)*100);return m;};
const CNP={},CNGAP={},CNINTRA={};
for(const s of Object.keys(CN)){
  CNP[s]=pmap(CN[s]);
  const g=new Map(),it=new Map();
  for(let i=1;i<CN[s].length;i++){
    const prev=CN[s][i-1].close,b=CN[s][i];
    if(prev&&b.open){g.set(b.day,(b.open/prev-1)*100);it.set(b.day,(b.close/b.open-1)*100);}
  }
  CNGAP[s]=g;CNINTRA[s]=it;
}
const YP={};for(const k of Object.keys(Y))YP[k]=pmap(Y[k]);
const YD={};for(const k of Object.keys(Y))YD[k]=Y[k].map(b=>b.day);
function prevPct(k,d){const ds=YD[k];let lo=0,hi=ds.length-1,best=null;while(lo<=hi){const m=(lo+hi)>>1;if(ds[m]<d){best=ds[m];lo=m+1;}else hi=m-1;}return best?YP[k].get(best)??null:null;}

// A股 2026 交易日历（以上证为准）
const DAYS=(CN["sh000001"]||[]).map(b=>b.day).filter(d=>d>="2026-01-05");
console.log("CN days:",DAYS.length);

function corr(a,b){const n=Math.min(a.length,b.length);if(n<8)return null;const A=a.slice(-n),B=b.slice(-n);const ma_=A.reduce((s,x)=>s+x,0)/n,mb=B.reduce((s,x)=>s+x,0)/n;let cov=0,va=0,vb=0;for(let i=0;i<n;i++){const da=A[i]-ma_,db=B[i]-mb;cov+=da*db;va+=da*da;vb+=db*db;}return(va===0||vb===0)?null:cov/Math.sqrt(va*vb);}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function pair(fx,fy){const xs=[],ys=[];for(const d of DAYS){const x=fx(d),y=fy(d);if(Number.isFinite(x)&&Number.isFinite(y)){xs.push(x);ys.push(y);}}return[xs,ys];}
const basketPct = (tag,d) => {const vals=BASKETS[tag].map(s=>CNP[s]?.get(d)).filter(Number.isFinite);return vals.length?mean(vals):null;};

let rpt="=== CROSS-MARKET AUDIT (2026 YTD) ===\n";
rpt+=`CN days=${DAYS.length} (${DAYS[0]} .. ${DAYS[DAYS.length-1]})\n`;

/* A. 隔夜美股 → A股当日 */
rpt+="\n--- A. 隔夜纳指(T-1) → A股(T)：跳空 / 日内 / 收盘 相关系数 ---\n";
rpt+="指数      | →跳空gap | →日内o2c | →收盘pct\n";
for(const [s,name] of CN_IDX){
  const [x1,y1]=pair(d=>prevPct("IXIC",d),d=>CNGAP[s].get(d));
  const [x2,y2]=pair(d=>prevPct("IXIC",d),d=>CNINTRA[s].get(d));
  const [x3,y3]=pair(d=>prevPct("IXIC",d),d=>CNP[s].get(d));
  rpt+=`${name.padEnd(8)} | ${corr(x1,y1)?.toFixed(3)} (n=${x1.length}) | ${corr(x2,y2)?.toFixed(3)} | ${corr(x3,y3)?.toFixed(3)}\n`;
}
{
  const [x,y]=pair(d=>prevPct("GSPC",d),d=>CNP["sh000001"].get(d));
  rpt+=`(参考: 标普→上证收盘 ${corr(x,y)?.toFixed(3)})\n`;
}

/* B. 分月耦合演变 */
rpt+="\n--- B. 纳指隔夜→创业板收盘 相关系数 · 分月（验证解耦叙事 O4） ---\n";
const months=[...new Set(DAYS.map(d=>d.slice(0,7)))].sort();
for(const m of months){
  const sub=DAYS.filter(d=>d.startsWith(m));
  const xs=[],ys=[],gs=[];
  for(const d of sub){const x=prevPct("IXIC",d),y=CNP["sz399006"].get(d),g=CNGAP["sz399006"].get(d);if(Number.isFinite(x)&&Number.isFinite(y)){xs.push(x);ys.push(y);gs.push(g);}}
  rpt+=`${m}: 收盘corr=${xs.length>7?corr(xs,ys).toFixed(3):"n"+xs.length}  跳空corr=${xs.length>7?corr(xs,gs).toFixed(3):"-"} (n=${xs.length})\n`;
}

/* C. 大涨/大跌夜不对称 */
rpt+="\n--- C. 美股极端夜(纳指T-1) → A股(T) 反应（创业板） ---\n";
for(const [label,f] of [["跌≤-1.5%",x=>x<=-1.5],["跌-1.5~-0.5",x=>x>-1.5&&x<=-0.5],["平-0.5~+0.5",x=>x>-0.5&&x<0.5],["涨+0.5~1.5",x=>x>=0.5&&x<1.5],["涨≥+1.5%",x=>x>=1.5]]){
  const gaps=[],intr=[],cls=[];
  for(const d of DAYS){
    const x=prevPct("IXIC",d);
    if(!Number.isFinite(x)||!f(x))continue;
    const g=CNGAP["sz399006"].get(d),it=CNINTRA["sz399006"].get(d),c=CNP["sz399006"].get(d);
    if(Number.isFinite(g)){gaps.push(g);intr.push(it);cls.push(c);}
  }
  rpt+=`${label.padEnd(12)}: n=${gaps.length} gap=${gaps.length?mean(gaps).toFixed(2):"-"}% intraday=${intr.length?mean(intr).toFixed(2):"-"}% close=${cls.length?mean(cls).toFixed(2):"-"}%\n`;
}

/* D. 日韩 */
rpt+="\n--- D. 日韩 ↔ A股 ---\n";
for(const [k,nm] of [["N225","日经"],["KS11","KOSPI"]]){
  const [x1,y1]=pair(d=>YP[k].get(d),d=>CNP["sz399006"].get(d));          // 同日并发
  const [x2,y2]=pair(d=>prevPct(k,d),d=>CNP["sz399006"].get(d));          // 前日→A股
  // A股→次日日韩: 对每个A股日d，找日韩下一交易日
  const xs3=[],ys3=[];
  for(const d of DAYS){
    const a=CNP["sz399006"].get(d);
    const nd=YD[k].find(x=>x>d);
    const jk=nd?YP[k].get(nd):null;
    if(Number.isFinite(a)&&Number.isFinite(jk)){xs3.push(a);ys3.push(jk);}
  }
  rpt+=`${nm}: 同日并发corr=${corr(x1,y1)?.toFixed(3)} (n=${x1.length}) | ${nm}前日→A股=${corr(x2,y2)?.toFixed(3)} | A股→次日${nm}=${corr(xs3,ys3)?.toFixed(3)}\n`;
}
{ // KOSPI 与 北证50（散户市对散户市）
  const [x,y]=pair(d=>YP["KS11"].get(d),d=>CNP["bj899050"].get(d));
  rpt+=`(KOSPI同日 vs 北证50: ${corr(x,y)?.toFixed(3)})\n`;
}

/* E. 锚传导 */
rpt+="\n--- E. 个股锚隔夜 → 板块篮子当日（全年 | 1-5月 | 6-8月） ---\n";
const seg1=d=>d<"2026-06-01", seg2=d=>d>="2026-06-01";
for(const [anchor,tags] of Object.entries(ANCHOR_MAP)){
  for(const tag of tags){
    const rows=[["全年",null],["1-5月",seg1],["6-8月",seg2]].map(([lb,f])=>{
      const xs=[],ys=[];
      for(const d of DAYS){
        if(f&&!f(d))continue;
        const x=prevPct(anchor,d),y=basketPct(tag,d);
        if(Number.isFinite(x)&&Number.isFinite(y)){xs.push(x);ys.push(y);}
      }
      const c=corr(xs,ys);
      return `${lb}=${c===null?"-":c.toFixed(3)}(${xs.length})`;
    });
    rpt+=`${anchor}→${tag.padEnd(4)}: ${rows.join("  ")}\n`;
  }
}
/* 纳指→池均对照 */
{
  const pool=d=>{const vals=Object.values(BASKETS).flat().map(s=>CNP[s]?.get(d)).filter(Number.isFinite);return vals.length?mean(vals):null;};
  const mk=f=>{const xs=[],ys=[];for(const d of DAYS){if(f&&!f(d))continue;const x=prevPct("IXIC",d),y=pool(d);if(Number.isFinite(x)&&Number.isFinite(y)){xs.push(x);ys.push(y);}}return corr(xs,ys);};
  rpt+=`(对照 IXIC→池均: 全年=${mk(null)?.toFixed(3)} 1-5月=${mk(seg1)?.toFixed(3)} 6-8月=${mk(seg2)?.toFixed(3)})\n`;
}

fs.writeFileSync("C:/Ev/_xmkt_report.txt",rpt,"utf8");
console.log(rpt);
