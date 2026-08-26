/* Poignee de zoom vertical (charts.js) — VRAI cablage extrait, VRAI doigt. */
const http=require('http'),fs=require('fs'),path=require('path');
const RACINE='/home/user/datatradingpro-v2',PUB=path.join(RACINE,'public'),PORT=4615;
const SRC=fs.readFileSync(path.join(RACINE,'public/js/charts.js'),'utf8');
const D=SRC.indexOf('function _attachYAxisDragZoom(container, yAxis, gutterW, onFitToggle) {');
const F=SRC.indexOf('\n}\n',D);
if(D<0){console.log('introuvable');process.exit(1);}
const CABLAGE=SRC.slice(D,F+3);
function bin(){const c=[];try{for(const d of fs.readdirSync('/opt/pw-browsers'))c.push(path.join('/opt/pw-browsers',d,'chrome-linux/chrome'));}catch{}return c.find(x=>fs.existsSync(x));}
const PAGE=`<!doctype html><html><head><link rel="stylesheet" href="/css/style.css"></head>
<body style="margin:0">
<div style="height:1400px">
 <div id="cont" style="width:390px;height:300px;position:relative;background:#111"></div>
</div></body></html>`;
function serveur(){return http.createServer((req,res)=>{const u=req.url.split('?')[0];
 if(u==='/'||u==='/t.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
 const f=path.join(PUB,u.replace(/^\/+/,''));
 if(!f.startsWith(PUB)||!fs.existsSync(f)){res.writeHead(404);return res.end('404');}
 res.writeHead(200,{'Content-Type':u.endsWith('.css')?'text/css':'application/octet-stream'});fs.createReadStream(f).pipe(res);});}
(async()=>{
 const pup=require('puppeteer-core');const srv=serveur();await new Promise(r=>srv.listen(PORT,r));
 const nav=await pup.launch({executablePath:bin(),headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await nav.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const cdp=await page.target().createCDPSession();
 await page.goto(`http://localhost:${PORT}/t.html`,{waitUntil:'networkidle2'});
 const info=await page.evaluate((cablage)=>{
   window.__z=[];
   var yAxis={ set:function(k,v){}, zoom:function(a,b){ window.__z.push([+a.toFixed(4),+b.toFixed(4)]); } };
   eval(cablage+'; window.__attach=_attachYAxisDragZoom;');
   window.__attach(document.getElementById('cont'), yAxis, 56, function(){});
   var g=document.querySelector('.cs-yzoom-grip'),cs=getComputedStyle(g),r=g.getBoundingClientRect();
   window.__cpt={d:0,m:0,u:0,c:0};
   ['pointerdown','pointermove','pointerup','pointercancel'].forEach(t=>g.addEventListener(t,()=>window.__cpt[t==='pointerdown'?'d':t==='pointermove'?'m':t==='pointerup'?'u':'c']++,true));
   window.__cap=[]; var op=Element.prototype.setPointerCapture;
   Element.prototype.setPointerCapture=function(id){window.__cap.push(this.className||this.tagName);return op.call(this,id);};
   return {zoomHtml:getComputedStyle(document.documentElement).zoom, ta:cs.touchAction, offsetW:g.offsetWidth, offsetH:g.offsetHeight,
     rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
     dessus:(()=>{var t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return t?(t.className||t.tagName):null;})()};
 },CABLAGE);
 console.log('YZOOM (cablage reel)',JSON.stringify(info,null,1));
 const cx=info.rect.x+info.rect.w/2, cy=info.rect.y+info.rect.h/2;
 const scrollAv=await page.evaluate(()=>(document.scrollingElement||document.body).scrollTop);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:1}]});
 await new Promise(r=>setTimeout(r,50));
 for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx,y:cy-6*i,id:1}]});await new Promise(r=>setTimeout(r,16));}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await new Promise(r=>setTimeout(r,400));
 const res=await page.evaluate(()=>({cpt:window.__cpt,zooms:window.__z.length,dernier:window.__z[window.__z.length-1],cap:window.__cap,scroll:(document.scrollingElement||document.body).scrollTop}));
 console.log('DOIGT (montee de 96 px ecran) ->',JSON.stringify(res));
 // meme geste a la souris pour comparer le DELTA (zoom 90%)
 await page.evaluate(()=>{window.__z=[];});
 await page.mouse.move(cx,cy);await page.mouse.down();
 for(let i=1;i<=16;i++){await page.mouse.move(cx,cy-6*i);await new Promise(r=>setTimeout(r,16));}
 await page.mouse.up();await new Promise(r=>setTimeout(r,300));
 const res2=await page.evaluate(()=>({zooms:window.__z.length,dernier:window.__z[window.__z.length-1]}));
 console.log('SOURIS meme geste ->',JSON.stringify(res2));
 // Le meme, dans une page SANS zoom : combien de clientY pour 96 px ecran ?
 const cy2=await page.evaluate(()=>{window.__cy=[];const g=document.querySelector('.cs-yzoom-grip');
   g.addEventListener('pointermove',e=>window.__cy.push(Math.round(e.clientY)),true);return 1;});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:1}]});
 await new Promise(r=>setTimeout(r,40));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx,y:cy-100,id:1}]});
 await new Promise(r=>setTimeout(r,60));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const cyv=await page.evaluate(()=>({depart:Math.round(window.__cyDep||0),vus:window.__cy}));
 console.log('clientY vus pour un deplacement ECRAN de -100 px, depuis y='+Math.round(cy)+' :',JSON.stringify(cyv));
 await nav.close();srv.close();
})().catch(e=>{console.error('BOOM',e.stack);process.exit(1);});
