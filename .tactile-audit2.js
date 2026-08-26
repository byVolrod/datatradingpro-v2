const http=require('http'),fs=require('fs'),path=require('path');
const RACINE='/home/user/datatradingpro-v2', PUB=path.join(RACINE,'public'), PORT=4612;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const UTIL={id:'u1',email:'v@dtp',name:'V',role:'admin',plan:'pro',active:true,expiry:null};
const CCY=['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD'],now=Date.now();
const CS={currencies:CCY,series:Object.fromEntries(CCY.map((c,i)=>[c,Array.from({length:60},(_,k)=>({t:now-(59-k)*3600000,v:Math.sin((k+i*7)/6)*(0.4+i*0.05)}))]))};
function serveur(){return http.createServer((req,res)=>{const u=req.url.split('?')[0];const j=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
 if(u.startsWith('/api/')){if(u==='/api/currency-strength')return j(CS);if(u==='/api/news')return j({items:[],total:0});return j({items:[],total:0,ok:true,loggedIn:true,authenticated:true,user:UTIL,...UTIL});}
 const f=path.join(PUB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});}
function bin(){const bs=['/opt/pw-browsers'];const c=[];for(const b of bs){try{for(const d of fs.readdirSync(b))for(const r of ['chrome-linux/chrome'])c.push(path.join(b,d,r));}catch{}}return c.find(x=>fs.existsSync(x));}
(async()=>{
 const pup=require('puppeteer-core');const srv=serveur();await new Promise(r=>srv.listen(PORT,r));
 const nav=await pup.launch({executablePath:bin(),headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await nav.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const cdp=await page.target().createCDPSession();
 await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,3500));
 const toucher=async(x0,y0,x1,y1,pas=14)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0,id:1}]});
  for(let i=1;i<=pas;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/pas,y:y0+(y1-y0)*i/pas,id:1}]});await new Promise(r=>setTimeout(r,16));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,300));};
 await page.evaluate(()=>{window.activateView('widgets');});
 await new Promise(r=>setTimeout(r,1200));
 let n=await page.evaluate(()=>document.querySelectorAll('#view-widgets .wdg-card').length);
 if(!n){await page.evaluate(()=>{try{DTPWidgets.applyPreset(0);}catch(e){}});await new Promise(r=>setTimeout(r,2500));}

 // ══ A. CORRECTIF ESSAYE POUR DE VRAI : touch-action:none rendu aux poignees ══
 await page.evaluate(()=>{const s=document.createElement('style');
   s.textContent='@media (hover:none),(pointer:coarse){#view-widgets .wdg-card .wdg-resize,#view-widgets .wdg-card .wdg-resize-e{touch-action:none!important;}}';
   document.head.appendChild(s);});
 await page.evaluate(()=>{window.__cpt={down:0,move:0,up:0,cancel:0};const h=document.querySelector('.wdg-grid');window.__h=h;['pointerdown','pointermove','pointerup','pointercancel'].forEach(t=>h.addEventListener(t,()=>window.__cpt[t.replace('pointer','')]++,true));
   window.__cx=[];h.addEventListener('pointermove',e=>{window.__cx.push([Math.round(e.clientX),Math.round(e.clientY)]);},true);});
 const g=await page.evaluate(()=>{const e=document.querySelector('#view-widgets .wdg-card .wdg-resize'),r=e.getBoundingClientRect();
   return {ta:getComputedStyle(e).touchAction,x:r.x+r.width/2,y:r.y+r.height/2};});
 const av=await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return{gw:c.style.getPropertyValue('--gw'),gh:c.style.getPropertyValue('--gh'),w:c.offsetWidth,h:c.offsetHeight};});
 await toucher(g.x,g.y,g.x-90,g.y+120);
 const ap=await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return{gw:c.style.getPropertyValue('--gw'),gh:c.style.getPropertyValue('--gh'),w:c.offsetWidth,h:c.offsetHeight,cpt:window.__cpt,cx:window.__cx.slice(0,3).concat(window.__cx.slice(-2))};});
 console.log('A) CORRECTIF touch-action:none — ta=',g.ta,'depart(px ecran)',Math.round(g.x)+','+Math.round(g.y));
 console.log('   avant',JSON.stringify(av),'\n   apres',JSON.stringify(ap));

 // ══ B. ZOOM 90% : l'espace de clientX vs l'espace de l'ecran ══
 console.log('B) ZOOM — geste ecran dx=-90 dy=+120 ; clientX/Y vus par le code :',JSON.stringify(ap.cx));

 // ══ C. POIGNEE D'ONGLET (panneau a onglets) au doigt ══
 const tabs=await page.evaluate(()=>{
   // trouver une carte a onglets ; sinon en fabriquer une comme le desk le fait
   const c=document.querySelector('#view-widgets .wdg-card'); if(!c) return null;
   try{ DTPWidgets.openSettings ? 0:0; }catch(e){}
   return {n:document.querySelectorAll('.wdg-set-tabgrip').length};
 });
 console.log('C) poignees d onglet presentes au depart:',JSON.stringify(tabs));
 // ouvrir les reglages de la 1ere carte a onglets s'il y en a une
 const info=await page.evaluate(()=>{
   const cards=[...document.querySelectorAll('#view-widgets .wdg-card')];
   const t=cards.find(c=>c.querySelector('.wdgt-bar'));
   return {tabCards:cards.filter(c=>c.querySelector('.wdgt-bar')).length, total:cards.length,
           ids:cards.map(c=>c.getAttribute('data-idx')+':'+(c.querySelector('.wdgt-bar')?'onglets':'simple'))};
 });
 console.log('   cartes:',JSON.stringify(info));
 console.log('ERREURS',JSON.stringify([...new Set(errs)].slice(0,4)));
 await nav.close();srv.close();
})().catch(e=>{console.error('BOOM',e);process.exit(1);});
