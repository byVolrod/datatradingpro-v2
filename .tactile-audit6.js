const http=require('http'),fs=require('fs'),path=require('path');
const RACINE='/home/user/datatradingpro-v2',PUB=path.join(RACINE,'public'),PORT=4616;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
const UTIL={id:'u1',email:'v@dtp',name:'V',role:'admin',plan:'pro',active:true,expiry:null};
function serveur(){return http.createServer((req,res)=>{const u=req.url.split('?')[0];const j=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
 if(u.startsWith('/api/'))return j({items:[],total:0,ok:true,loggedIn:true,authenticated:true,user:UTIL,...UTIL});
 const f=path.join(PUB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});}
function bin(){const c=[];try{for(const d of fs.readdirSync('/opt/pw-browsers'))c.push(path.join('/opt/pw-browsers',d,'chrome-linux/chrome'));}catch{}return c.find(x=>fs.existsSync(x));}
(async()=>{
 const pup=require('puppeteer-core');const srv=serveur();await new Promise(r=>srv.listen(PORT,r));
 const nav=await pup.launch({executablePath:bin(),headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await nav.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const cdp=await page.target().createCDPSession();
 await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle2',timeout:60000});
 await new Promise(r=>setTimeout(r,3500));
 const toucher=async(x0,y0,x1,y1,pas=20)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0,id:1}]});
  await new Promise(r=>setTimeout(r,40));
  for(let i=1;i<=pas;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/pas,y:y0+(y1-y0)*i/pas,id:1}]});await new Promise(r=>setTimeout(r,16));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,350));};
 await page.evaluate(()=>window.activateView('widgets'));await new Promise(r=>setTimeout(r,1500));
 let n=await page.evaluate(()=>document.querySelectorAll('#view-widgets .wdg-card').length);
 if(!n){await page.evaluate(()=>{try{DTPWidgets.applyPreset(0);}catch(e){}});await new Promise(r=>setTimeout(r,2500));}
 // rendre touch-action:none aux poignees (correctif minimal) pour pouvoir MESURER le delta
 await page.evaluate(()=>{const s=document.createElement('style');
  s.textContent='@media (hover:none),(pointer:coarse){.wdg-resize,.wdg-resize-e{touch-action:none!important}}';document.head.appendChild(s);});

 const base=await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card'),h=document.querySelector('.wdg-grid');
  const r=c.getBoundingClientRect(),cs=getComputedStyle(h);
  return {rect:{x:+r.x.toFixed(1),w:+r.width.toFixed(1),right:+r.right.toFixed(1)},offsetW:c.offsetWidth,gw:+c.style.getPropertyValue('--gw'),
    gapC:cs.columnGap, colVisuel:+(r.width/ +c.style.getPropertyValue('--gw')).toFixed(2),
    colCode:+(((c.offsetWidth+parseFloat(cs.columnGap))/ +c.style.getPropertyValue('--gw'))).toFixed(2)};});
 console.log('BASE',JSON.stringify(base));
 console.log('  -> colonne A L ECRAN =',base.colVisuel,'px ; colonne UTILISEE PAR LE CODE =',base.colCode,'px ; ecart',
   (100*(base.colCode/base.colVisuel-1)).toFixed(1)+'%');

 // A : glisser EXACTEMENT la largeur ecran de 2 colonnes -> le code devrait retirer 2 colonnes
 const h1=await page.evaluate(()=>{const e=document.querySelector('#view-widgets .wdg-card .wdg-resize'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
 const d2=2*base.colVisuel;
 await toucher(h1.x,h1.y,h1.x-d2,h1.y);
 const a=await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card'),r=c.getBoundingClientRect();return {gw:c.style.getPropertyValue('--gw'),right:+r.right.toFixed(1)};});
 console.log('A) doigt recule de '+d2.toFixed(1)+' px ecran (= 2 colonnes vues) -> gw '+base.gw+' -> '+a.gw+
   ' ; bord droit de la carte '+base.rect.right+' -> '+a.right+' (le doigt, lui, est a '+(h1.x-d2).toFixed(1)+')');

 // B : BANDE MORTE — un balayage VERTICAL sur la poignee de bord droit fait-il defiler ?
 await page.evaluate(()=>{const g=document.querySelector('.wdg-grid');window.__sc0=g.scrollTop;});
 const h2=await page.evaluate(()=>{const e=document.querySelector('#view-widgets .wdg-card .wdg-resize-e'),r=e.getBoundingClientRect();
   return {x:r.x+r.width/2,y:r.y+r.height/2,w:+r.width.toFixed(1),h:+r.height.toFixed(1)};});
 const sc0=await page.evaluate(()=>{const g=document.querySelector('.wdg-grid');return {grid:g.scrollTop,page:(document.scrollingElement||document.body).scrollTop};});
 await toucher(h2.x,h2.y,h2.x,h2.y-200,20);
 const sc1=await page.evaluate(()=>{const g=document.querySelector('.wdg-grid');return {grid:g.scrollTop,page:(document.scrollingElement||document.body).scrollTop};});
 console.log('B) bande de bord droit '+h2.w+'x'+h2.h+' px ecran ; balayage vertical de 200 px -> defilement',JSON.stringify(sc0),'->',JSON.stringify(sc1));
 await nav.close();srv.close();
})().catch(e=>{console.error('BOOM',e.stack);process.exit(1);});
