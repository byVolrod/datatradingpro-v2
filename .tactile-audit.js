/* Mesure AU DOIGT — vrais evenements d'entree via CDP Input.dispatchTouchEvent. */
const http = require('http'), fs = require('fs'), path = require('path');
const RACINE = '/home/user/datatradingpro-v2';
const PUB = path.join(RACINE, 'public');
const PORT = 4611;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const UTIL = { id:'u1', email:'v@dtp', name:'V', role:'admin', plan:'pro', active:true, expiry:null };
const CCY = ['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD'];
const now = Date.now();
const CS = { currencies: CCY, series: Object.fromEntries(CCY.map((c,i)=>[c, Array.from({length:60},(_,k)=>({t: now-(59-k)*3600000, v: Math.sin((k+i*7)/6)*(0.4+i*0.05)}))])) };
function serveur(){
  return http.createServer((req,res)=>{
    const u=req.url.split('?')[0];
    const j=o=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
    if(u.startsWith('/api/')){
      if(u==='/api/currency-strength') return j(CS);
      if(u==='/api/news') return j({items:[],total:0});
      return j({items:[],total:0,ok:true,loggedIn:true,authenticated:true,user:UTIL,...UTIL});
    }
    const f=path.join(PUB,u==='/'?'index.html':u.replace(/^\/+/,''));
    if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
}
function trouverNavigateur(){
  const bases=['/opt/pw-browsers',process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const c=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'];
  for(const b of bases){try{for(const d of fs.readdirSync(b))for(const rel of ['chrome-linux/chrome','chrome-linux/headless_shell'])c.push(path.join(b,d,rel));}catch{}}
  return c.find(x=>x&&fs.existsSync(x))||null;
}
(async()=>{
  const bin=trouverNavigateur();
  if(!bin){console.log('PAS DE CHROMIUM');process.exit(2);}
  console.log('chromium:',bin);
  const puppeteer=require('puppeteer-core');
  const srv=serveur(); await new Promise(r=>srv.listen(PORT,r));
  const nav=await puppeteer.launch({executablePath:bin,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--touch-events=enabled']});
  const page=await nav.newPage();
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const cdp=await page.target().createCDPSession();
  await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r=>setTimeout(r,3500));

  // — geste tactile REEL (CDP) —
  async function toucher(x0,y0,x1,y1,pas){
    pas=pas||14;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0,id:1}]});
    for(let i=1;i<=pas;i++){
      const x=x0+(x1-x0)*i/pas, y=y0+(y1-y0)*i/pas;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:1}]});
      await new Promise(r=>setTimeout(r,16));
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await new Promise(r=>setTimeout(r,250));
  }

  // ─── DESK ────────────────────────────────────────────────────────────────
  const ouvert = await page.evaluate(()=>{
    try{ window.activateView('widgets'); }catch(e){ return 'activateView KO: '+e.message; }
    return document.getElementById('view-widgets') && !document.getElementById('view-widgets').classList.contains('hidden');
  });
  await new Promise(r=>setTimeout(r,1200));
  let etat = await page.evaluate(()=>({ cartes: document.querySelectorAll('#view-widgets .wdg-card').length, blank: !!document.querySelector('.wdg-blank') }));
  if(!etat.cartes){
    await page.evaluate(()=>{ try{ DTPWidgets.applyPreset(0); }catch(e){} });
    await new Promise(r=>setTimeout(r,2000));
    etat = await page.evaluate(()=>({ cartes: document.querySelectorAll('#view-widgets .wdg-card').length, blank: !!document.querySelector('.wdg-blank') }));
  }
  console.log('DESK ouvert:',ouvert,'cartes:',etat.cartes,'blank:',etat.blank);

  // instrumentation : compter les pointer events reellement recus
  await page.evaluate(()=>{
    window.__cpt={down:0,move:0,up:0,cancel:0,touchstart:0,touchmove:0};
    const h=document.getElementById('widgets-grid')||document.querySelector('.wdg-grid');
    window.__host=h;
    if(h){['pointerdown','pointermove','pointerup','pointercancel'].forEach(t=>h.addEventListener(t,()=>{window.__cpt[t.replace('pointer','')]++;},true));}
    document.addEventListener('touchstart',()=>window.__cpt.touchstart++,true);
    document.addEventListener('touchmove',()=>window.__cpt.touchmove++,true);
  });

  const geo = await page.evaluate(()=>{
    const out={};
    const zoom = getComputedStyle(document.documentElement).zoom;
    out.zoom = zoom;
    out.dpr = window.devicePixelRatio;
    const mesure=(sel)=>{
      const e=document.querySelector(sel); if(!e) return null;
      const cs=getComputedStyle(e), r=e.getBoundingClientRect();
      return { sel, touchAction:cs.touchAction, rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
               offset:{w:e.offsetWidth,h:e.offsetHeight}, display:cs.display, visible: r.width>0&&r.height>0,
               dessus: (()=>{ const t=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return t? (t.className&&t.className.baseVal!==undefined?t.className.baseVal:t.className)||t.tagName : null; })() };
    };
    out.coin = mesure('#view-widgets .wdg-card .wdg-resize');
    out.bord = mesure('#view-widgets .wdg-card .wdg-resize-e');
    out.splitter = mesure('#layout-resizer');
    const c=document.querySelector('#view-widgets .wdg-card');
    if(c){ const r=c.getBoundingClientRect(); out.carte={ rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}, offsetW:c.offsetWidth, gw:c.style.getPropertyValue('--gw'), gh:c.style.getPropertyValue('--gh'), idx:c.getAttribute('data-idx') }; }
    return out;
  });
  console.log('GEO', JSON.stringify(geo,null,1));

  // ── geste au doigt sur la poignee de COIN ──
  if(geo.coin && geo.coin.visible){
    const cx=geo.coin.rect.x+geo.coin.rect.w/2, cy=geo.coin.rect.y+geo.coin.rect.h/2;
    const avant = await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return {gw:c.style.getPropertyValue('--gw'),gh:c.style.getPropertyValue('--gh'),w:c.offsetWidth,h:c.offsetHeight,scroll:(document.scrollingElement||document.body).scrollTop};});
    await toucher(cx,cy,cx-90,cy+120);
    const apres = await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return {gw:c.style.getPropertyValue('--gw'),gh:c.style.getPropertyValue('--gh'),w:c.offsetWidth,h:c.offsetHeight,scroll:(document.scrollingElement||document.body).scrollTop,cpt:window.__cpt};});
    console.log('COIN avant',JSON.stringify(avant),'apres',JSON.stringify(apres));
  }
  // ── geste au doigt sur la poignee de BORD DROIT ──
  if(geo.bord && geo.bord.visible){
    await page.evaluate(()=>{window.__cpt={down:0,move:0,up:0,cancel:0,touchstart:0,touchmove:0};const h=window.__host;});
    const bx=geo.bord.rect.x+geo.bord.rect.w/2, by=geo.bord.rect.y+geo.bord.rect.h/2;
    const avant = await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return {gw:c.style.getPropertyValue('--gw'),w:c.offsetWidth};});
    await toucher(bx,by,bx-100,by);
    const apres = await page.evaluate(()=>{const c=document.querySelector('#view-widgets .wdg-card');return {gw:c.style.getPropertyValue('--gw'),w:c.offsetWidth,cpt:window.__cpt};});
    console.log('BORD avant',JSON.stringify(avant),'apres',JSON.stringify(apres));
  }
  console.log('ERREURS',JSON.stringify([...new Set(errs)].slice(0,5)));
  await nav.close(); srv.close();
})().catch(e=>{console.error('BOOM',e);process.exit(1);});
