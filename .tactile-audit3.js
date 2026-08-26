const http=require('http'),fs=require('fs'),path=require('path');
const RACINE='/home/user/datatradingpro-v2',PUB=path.join(RACINE,'public'),PORT=4613;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const UTIL={id:'u1',email:'v@dtp',name:'V',role:'admin',plan:'pro',active:true,expiry:null};
const CCY=['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD'],now=Date.now();
const CS={currencies:CCY,series:Object.fromEntries(CCY.map((c,i)=>[c,Array.from({length:60},(_,k)=>({t:now-(59-k)*3600000,v:Math.sin((k+i*7)/6)*(0.4+i*0.05)}))]))};
function serveur(){return http.createServer((req,res)=>{const u=req.url.split('?')[0];const j=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
 if(u.startsWith('/api/')){if(u==='/api/currency-strength')return j(CS);if(u==='/api/news')return j({items:[],total:0});return j({items:[],total:0,ok:true,loggedIn:true,authenticated:true,user:UTIL,...UTIL});}
 const f=path.join(PUB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});}
function bin(){const c=[];try{for(const d of fs.readdirSync('/opt/pw-browsers'))c.push(path.join('/opt/pw-browsers',d,'chrome-linux/chrome'));}catch{}return c.find(x=>fs.existsSync(x));}
const VP=process.argv[2]==='tablette'?{width:1366,height:1024,isMobile:false,hasTouch:true,deviceScaleFactor:2}:{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3};
(async()=>{
 const pup=require('puppeteer-core');const srv=serveur();await new Promise(r=>srv.listen(PORT,r));
 const nav=await pup.launch({executablePath:bin(),headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await nav.newPage();await page.setViewport(VP);
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const cdp=await page.target().createCDPSession();
 await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,3500));
 const toucher=async(x0,y0,x1,y1,pas=16)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0,id:1}]});
  await new Promise(r=>setTimeout(r,40));
  for(let i=1;i<=pas;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/pas,y:y0+(y1-y0)*i/pas,id:1}]});await new Promise(r=>setTimeout(r,16));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,350));};
 console.log('== viewport',JSON.stringify(VP));

 // ── LE SPLITTER DORE DU DESK (layout-resizer) ──
 const sp=await page.evaluate(()=>{const e=document.getElementById('layout-resizer');if(!e)return null;const cs=getComputedStyle(e),r=e.getBoundingClientRect();
   const zone=(()=>{const a=getComputedStyle(e,'::after');return {left:a.left,right:a.right,w:a.width};})();
   const l=document.getElementById('main-layout');
   return {display:cs.display,ta:cs.touchAction,rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},apres:zone,sidebar:getComputedStyle(l).getPropertyValue('--sidebar-w'),inline:l.style.getPropertyValue('--sidebar-w')};});
 console.log('SPLITTER',JSON.stringify(sp));
 if(sp&&sp.display!=='none'&&sp.rect.h>0){
   // zone de prehension : ::after left -1 right -12 -> deborde a droite
   const x=sp.rect.x+6, y=sp.rect.y+sp.rect.h/2;
   const av=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
   await toucher(x,y,x-160,y);
   const ap=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
   console.log('SPLITTER doigt: avant="'+av+'" apres="'+ap+'"  (largeur zone tap reelle ~13 CSS px)');
   // et a la souris, meme geste
   await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=10;i++){await page.mouse.move(x-16*i,y);await new Promise(r=>setTimeout(r,16));}await page.mouse.up();
   const ap2=await page.evaluate(()=>document.getElementById('main-layout').style.getPropertyValue('--sidebar-w'));
   console.log('SPLITTER souris: apres="'+ap2+'"');
 }

 // ── DESK ──
 await page.evaluate(()=>window.activateView('widgets'));
 await new Promise(r=>setTimeout(r,1500));
 let n=await page.evaluate(()=>document.querySelectorAll('#view-widgets .wdg-card').length);
 if(!n){await page.evaluate(()=>{try{DTPWidgets.applyPreset(0);}catch(e){}});await new Promise(r=>setTimeout(r,2500));}

 // ── POIGNEE D'ONGLET (deja corrigee ?) : ouvrir les reglages de la carte a onglets ──
 const idxT=await page.evaluate(()=>{const cs=[...document.querySelectorAll('#view-widgets .wdg-card')];const t=cs.find(c=>c.querySelector('.wdgt-bar'));return t?+t.getAttribute('data-idx'):null;});
 if(idxT!=null){
   await page.evaluate(i=>DTPWidgets.toggleSettings(i),idxT);
   await new Promise(r=>setTimeout(r,700));
   const gr=await page.evaluate(()=>{const gs=[...document.querySelectorAll('.wdg-set-tabgrip')].filter(g=>g.getBoundingClientRect().width>0);
     if(!gs.length)return null;const g=gs[0],cs=getComputedStyle(g),r=g.getBoundingClientRect();
     const rows=[...document.querySelectorAll('.wdg-set-tabrow')].filter(x=>x.getBoundingClientRect().width>0);
     return {n:gs.length,ta:cs.touchAction,w:+r.width.toFixed(1),h:+r.height.toFixed(1),
       grips:gs.slice(0,8).map(g=>{const r=g.getBoundingClientRect();return {j:g.getAttribute('data-j'),x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};}),
       noms:[...document.querySelectorAll('.wdg-set-tabin')].map(i=>i.value)};});
   console.log('GRIP ONGLET',JSON.stringify(gr));
   if(gr&&gr.grips.length>=3){
     const last=gr.grips[gr.grips.length-1],first=gr.grips[0];
     await toucher(last.x,last.y,first.x,first.y-6,20);
     const apres=await page.evaluate(()=>[...document.querySelectorAll('.wdg-set-tabin')].map(i=>i.value));
     console.log('GRIP ONGLET doigt: avant',JSON.stringify(gr.noms),'-> apres',JSON.stringify(apres));
   }
   await page.evaluate(i=>DTPWidgets.toggleSettings(i),idxT);
 }

 // ── POIGNEE DE ZOOM VERTICAL DES GRAPHIQUES ──
 await new Promise(r=>setTimeout(r,1500));
 const yz=await page.evaluate(()=>{const gs=[...document.querySelectorAll('.cs-yzoom-grip')].filter(g=>g.getBoundingClientRect().width>0);
   if(!gs.length)return {n:0,total:document.querySelectorAll('.cs-yzoom-grip').length};
   const g=gs[0],cs=getComputedStyle(g),r=g.getBoundingClientRect();
   return {n:gs.length,ta:cs.touchAction,rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
     dessus:(()=>{const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return t?(t.className.baseVal!==undefined?t.className.baseVal:t.className)||t.tagName:null;})()};});
 console.log('YZOOM',JSON.stringify(yz));
 if(yz.n){
   await page.evaluate(()=>{const g=document.querySelector('.cs-yzoom-grip');window.__yz={d:0,m:0,u:0,c:0};
     ['pointerdown','pointermove','pointerup','pointercancel'].forEach(t=>g.addEventListener(t,()=>window.__yz[t==='pointerdown'?'d':t==='pointermove'?'m':t==='pointerup'?'u':'c']++,true));});
   const cx=yz.rect.x+yz.rect.w/2,cy=yz.rect.y+yz.rect.h/2;
   const av=await page.evaluate(()=>{const c=document.querySelector('.cs-yzoom-grip').parentNode.querySelector('svg');return document.body.scrollTop;});
   await toucher(cx,cy,cx,cy-120,16);
   const ap=await page.evaluate(()=>window.__yz);
   console.log('YZOOM doigt: compteurs',JSON.stringify(ap));
 }

 // ── SPLITTER SMART BIAS (sbm-vsplit) ──
 await page.evaluate(()=>window.activateView('bias'));
 await new Promise(r=>setTimeout(r,2500));
 const sb=await page.evaluate(()=>{const e=document.getElementById('sbm-vsplit');if(!e)return {absent:true,cells:document.querySelectorAll('.mt-cell,.mt-row').length};
   const cs=getComputedStyle(e),a=getComputedStyle(e,'::after'),r=e.getBoundingClientRect();
   return {ta:cs.touchAction,h:+r.height.toFixed(1),zoneTop:a.top,zoneBottom:a.bottom,zoneH:a.height};});
 console.log('SBM-VSPLIT',JSON.stringify(sb));
 console.log('ERREURS',JSON.stringify([...new Set(errs)].slice(0,4)));
 await nav.close();srv.close();
})().catch(e=>{console.error('BOOM',e.stack);process.exit(1);});
