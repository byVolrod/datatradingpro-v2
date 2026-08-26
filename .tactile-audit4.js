const http=require('http'),fs=require('fs'),path=require('path');
const RACINE='/home/user/datatradingpro-v2',PUB=path.join(RACINE,'public'),PORT=4614;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const UTIL={id:'u1',email:'v@dtp',name:'V',role:'admin',plan:'pro',active:true,expiry:null};
const CCY=['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD'],now=Date.now();
const CS={currencies:CCY,series:Object.fromEntries(CCY.map((c,i)=>[c,Array.from({length:60},(_,k)=>({t:now-(59-k)*3600000,v:Math.sin((k+i*7)/6)*(0.4+i*0.05)}))]))};
function serveur(){return http.createServer((req,res)=>{const u=req.url.split('?')[0];const j=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
 if(u.startsWith('/api/')){if(u==='/api/currency-strength')return j(CS);if(u==='/api/news')return j({items:[],total:0});return j({items:[],total:0,ok:true,loggedIn:true,authenticated:true,user:UTIL,...UTIL});}
 const f=path.join(PUB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});}
function bin(){const c=[];try{for(const d of fs.readdirSync('/opt/pw-browsers'))c.push(path.join('/opt/pw-browsers',d,'chrome-linux/chrome'));}catch{}return c.find(x=>fs.existsSync(x));}
const W=+(process.argv[2]||1366),H=+(process.argv[3]||1024);
(async()=>{
 const pup=require('puppeteer-core');const srv=serveur();await new Promise(r=>srv.listen(PORT,r));
 const nav=await pup.launch({executablePath:bin(),headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await nav.newPage();await page.setViewport({width:W,height:H,isMobile:false,hasTouch:true,deviceScaleFactor:2});
 const cdp=await page.target().createCDPSession();
 await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,4000));
 await page.evaluate(()=>{try{window.activateView('news')}catch(e){};document.getElementById('main-layout').classList.remove('hide-right-panel');});
 await new Promise(r=>setTimeout(r,1200));
 const d=await page.evaluate(()=>{const e=document.getElementById('layout-resizer'),l=document.getElementById('main-layout');
  return {innerW:window.innerWidth,mmDesktop:matchMedia('(min-width: 1025px)').matches,mm1024:matchMedia('(max-width: 1024px)').matches,
   coarse:matchMedia('(pointer: coarse)').matches,hoverNone:matchMedia('(hover: none)').matches,
   cls:l.className,disp:getComputedStyle(e).display,ta:getComputedStyle(e).touchAction,
   r:(()=>{const r=e.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};})(),
   maxTouch:navigator.maxTouchPoints};});
 console.log('DIAG',JSON.stringify(d,null,1));
 if(d.disp!=='none'&&d.r.h>0){
  const x=d.r.x+5,y=d.r.y+d.r.h/2;
  const av=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await new Promise(r=>setTimeout(r,50));
  for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-10*i,y,id:1}]});await new Promise(r=>setTimeout(r,16));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await new Promise(r=>setTimeout(r,300));
  const ap=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
  console.log('SPLITTER DOIGT avant="'+av+'" apres="'+ap+'"');
  await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=16;i++){await page.mouse.move(x-10*i,y);await new Promise(r=>setTimeout(r,16));}await page.mouse.up();
  const ap2=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
  console.log('SPLITTER SOURIS apres="'+ap2+'"');
 }
 // ── graphique de force : forcer son rendu dans le panneau droit ──
 const yz=await page.evaluate(async()=>{
   const row=document.getElementById('strength-charts-row');
   const host=document.createElement('div');host.id='audit-cs';host.style.cssText='width:520px;height:300px;';
   (row||document.body).appendChild(host);
   const data=await fetch('/api/currency-strength').then(r=>r.json());
   var r2=null; try{ r2 = window.buildStrengthChart('audit-cs',data,{}); }catch(e){ return {err:e.message, am5:typeof window.am5}; }
   return {ok:true, am5:typeof window.am5, ret:!!r2, pts:(data.series.USD||[]).length};});
 await new Promise(r=>setTimeout(r,4000));
 const m=await page.evaluate(()=>{const g=document.querySelector('#audit-cs .cs-yzoom-grip');if(!g)return{absent:true,html:(document.getElementById('audit-cs')||{}).childElementCount};
  const cs=getComputedStyle(g),r=g.getBoundingClientRect();
  window.__yz={d:0,m:0,u:0,c:0};['pointerdown','pointermove','pointerup','pointercancel'].forEach(t=>g.addEventListener(t,()=>window.__yz[t==='pointerdown'?'d':t==='pointermove'?'m':t==='pointerup'?'u':'c']++,true));
  return {ta:cs.touchAction,inline:g.getAttribute('style'),rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},offsetW:g.offsetWidth};});
 console.log('YZOOM',JSON.stringify(m));
 if(!m.absent){
  const cx=m.rect.x+m.rect.w/2,cy=m.rect.y+m.rect.h/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:1}]});
  await new Promise(r=>setTimeout(r,50));
  for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx,y:cy-7*i,id:1}]});await new Promise(r=>setTimeout(r,16));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await new Promise(r=>setTimeout(r,300));
  const c=await page.evaluate(()=>window.__yz);
  console.log('YZOOM DOIGT compteurs',JSON.stringify(c));
 }
 await nav.close();srv.close();
})().catch(e=>{console.error('BOOM',e.stack);process.exit(1);});
