#!/usr/bin/env node
/* Run with Playwright and the repository static server.
   node tools/babylon-tour.cjs <out> <index URL> [--baseline <index URL>] [--no-story|--story-only] */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'babylon-tour';
const base = process.argv[3] || 'http://127.0.0.1:8080/index.html';
const args = process.argv.slice(4);
const focus = args.includes('--focus') ? new Set(args[args.indexOf('--focus') + 1].split(',')) : null;
const baseline = args.includes('--baseline') ? args[args.indexOf('--baseline') + 1] : null;
const report = { engine: 'Chromium/SwiftShader', viewport: [640, 360], direct: {} };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const write = (name, data) => fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
const query = (url, fields) => {
  const page = new URL(url);
  page.search = new URLSearchParams({ aa: '0', ...fields }).toString();
  return page.href;
};

async function open(browser, url) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [], downloads = new Map();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => {
    const file = decodeURIComponent(new URL(r.url()).pathname);
    if (file.startsWith('/assets/')) {
      downloads.set(file, +(r.headers()['content-length'] || 0));
      if (r.status() >= 400 && !file.endsWith('/sky_babylon_blood.jpeg')) errors.push(r.status() + ' ' + file);
    }
  });
  if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\//, r => r.fulfill({
    path: path.join(process.env.THREE_DIR, r.request().url().split('three@0.187.0/')[1].split('?')[0]), contentType: 'text/javascript'
  }));
  await page.addInitScript(() => {
    const probe = window.__babylonProbe = { frames: [], next: 0 };
    let renderer;
    Object.defineProperty(window, '__R', {
      configurable: true, get: () => renderer,
      set(value) {
        if (!value || value === renderer) return;
        renderer = value;
        queueMicrotask(() => {
          const render = value.render.bind(value);
          probe.render = render;
          value.render = (scene, camera) => {
            const hero = scene.isScene && scene.getObjectByName('SinHeroRoot');
            if (!hero || value.getRenderTarget()) return render(scene, camera);
            probe.hero = hero;
            probe.scene = scene;
            probe.camera = camera;
            const phase = window.PalaceInterior?.state();
            if (!probe.record || !document.body.classList.contains('playing')) return;
            const t = performance.now(), z = hero.position.z;
            if (phase !== 'IDLE' && phase !== 'DONE' && phase !== 'APPROACH') return;
            if (t < probe.next || probe.frames.length >= 126) return;
            // Draw only sampled frames in the capture. Simulation and input
            // still run through the normal browser game loop between samples.
            const distance = probe.lastZ === undefined ? Infinity : z - probe.lastZ;
            const cinematic = document.body.classList.contains('hero-cinematic') || phase === 'DONE';
            if (phase !== 'DONE' && cinematic) {
              probe.cinematicFrames = (probe.cinematicFrames || 0) + 1;
              if (probe.cinematicFrames % 14 !== 1) return;
            } else if (phase !== 'DONE' && distance < (z < 14 ? 3.5 : 6.5)) return;
            probe.next = t + (cinematic ? 550 : 100);
            probe.lastZ = z;
            render(scene, camera);
            probe.frames.push({ z, phase, jpg: value.domElement.toDataURL('image/jpeg', .84).split(',')[1] });
            if (phase === 'DONE') probe.record = false;
          };
        });
      }
    });
  });
  await page.goto(url);
  return { page, errors, downloads };
}

async function direct(browser, url, tag) {
  const launched = query(url, { dev: '1', level: 'OUT-START' });
  const { page, errors, downloads } = await open(browser, launched);
  try {
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 180000, polling: 500 });
    const entry = await page.evaluate(tag => {
      if (!__sinDev.ready) throw Error(__sinDev.error);
      const g = SinDevHub.game(), { renderer:r, scene, camera } = g;
      const hero = g.hero();
      const result = { spawn: hero.position.toArray(), bootMs: __sinDev.ms, spawnClear: !g.blocked(hero.position.x, hero.position.z) };
      if (tag === 'after') {
        const samples = [];
        for (let z=-42;z<150;z+=.25) samples.push(g.blocked(0,z));
        result.centerline = samples.filter(Boolean).length;
        result.gate = [g.blocked(0,0),g.blocked(5,0),g.ground(0,-9,hero.position.y),g.ground(0,9,hero.position.y)];
        result.bounds = [[0,-80],[19,-30],[-19,34],[32,107]].map(([x,z])=>g.blocked(x,z));
        SinDevHub.tools.setFly(true);
        const probe = __babylonProbe;
        probe.gameCamera = camera;
        probe.saved = camera.position.toArray();
      }
      return result;
    },tag);
    if (tag === 'after') await page.waitForFunction(() => __babylonProbe.camera !== __babylonProbe.gameCamera);
    const views = tag === 'before'
      ? [['start',[0,2.5,-36],[0,7.5,0]]]
      : [['start',[0,2.5,-36],[0,7.5,0]],['reference',[6.3,2.65,-40],[.2,8.4,3.5]],
        ['paving',[-3,3.1,-30],[.1,.15,-23]],['bazaar',[-6.1,2.4,-49],[-11.2,2.85,-35]],['gate-arch',[0,2.25,-9],[0,4.9,16]],
        ['palace',[5,3.0,120],[1,8.4,179]],['city',[6,23,73],[-78,15,142]]];
    const shots = {};
    for (const [name,position,target] of views) {
      if (focus && !focus.has(name)) continue;
      const shot = await page.evaluate(({position,target,name,tag}) => {
        const probe = __babylonProbe;
        const g = SinDevHub.game(), r = g.renderer;
        const c = tag === 'after' ? probe.camera : g.camera.clone(false);
        const oldPosition = c.position.clone(), oldRotation = c.quaternion.clone();
        c.position.set(...position);
        c.lookAt(...target);
        c.fov=47;c.aspect=640/360;c.updateProjectionMatrix();
        r.setPixelRatio(1);r.setSize(640,360,false);
        const scene=g.scene;
        const undo=new Map();
        SinAreas.chapterOf('outdoor')?.preview?.({
          camera:c, stream:false, place:(node,at)=>node.position.copy(at),
          show:(node,on)=>{if(!undo.has(node))undo.set(node,node.visible);node.visible=on;}
        });
        scene.getObjectByName('SkyPhoto')?.position.copy(c.position);
        scene.getObjectByName('skyline_distant_city')?.position.copy(c.position);
        const time = () => {
          const start=performance.now();
          probe.render(scene,c);
          const gl=r.getContext();
          gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
          return performance.now()-start;
        };
        time();
        const timings = name==='start' ? [time(),time(),time()] : [];
        const est = SinProcessMemory.estimate({scene,renderer:r});
        const jpg=r.domElement.toDataURL('image/jpeg',.92).split(',')[1];
        c.position.copy(oldPosition);c.quaternion.copy(oldRotation);
        for(const [node,on] of undo)node.visible=on;
        return {jpg, frameMs:timings.length?+(timings.sort((a,b)=>a-b)[1]).toFixed(1):null,
          drawCalls:r.info.render.calls, triangles:r.info.render.triangles, cpuMiB:est.cpuMB, gpuMiB:est.gpuMB};
      },{position,target,name,tag});
      write(tag+'-'+name+'.jpg',shot.jpg);
      delete shot.jpg;
      shots[name]=shot;
      console.log('frame',tag,name,shot);
    }
    if(tag==='after'){
      assert.equal(entry.centerline,0);
      assert.deepEqual(entry.gate,[false,true,0,0]);
      assert.ok(entry.bounds.every(Boolean));
      const exact=await page.evaluate(()=>{
        const p=__babylonProbe,g=SinDevHub.game();
        SinDevHub.tools.setFly(false);
        return !window.__holdSim && JSON.stringify(p.saved)===JSON.stringify(g.camera.position.toArray()) && g.hero().position.z===-30;
      });
      assert.ok(exact,'free fly restored the player and gameplay camera');
    }
    return { url:launched, ...entry, shots, downloadMiB:+([...downloads.values()].reduce((a,b)=>a+b,0)/1048576).toFixed(1), errors };
  } finally { await page.close(); }
}

async function story(browser) {
  const url=query(base,{});
  const {page,errors,downloads}=await open(browser,url);
  try {
    const game=page.locator('#sin-dev-gate [data-act=play]');
    await game.click();
    await page.waitForFunction(()=>document.getElementById('main-menu')?.style.display==='block',null,{timeout:180000,polling:350});
    await page.evaluate(()=>{__babylonProbe.record=true;document.getElementById('go').click();});
    await page.waitForFunction(()=>__babylonProbe.frames.length>=1,null,{timeout:180000,polling:350});
    console.log('New Game footage captured');
    const at = () => page.evaluate(()=>__babylonProbe.hero?.position.toArray());
    const waitZ = z=>page.waitForFunction(z=>__babylonProbe.hero?.position.z>=z ||
      (z>170 && PalaceInterior.state()!=='IDLE'),z,{timeout:420000,polling:350});
    const pos0=await at(), then=Date.now();
    await page.keyboard.down('KeyW');
    await waitZ(-23);
    const walked = {from:pos0,to:await at(),ms:Date.now()-then};
    await page.keyboard.down('ShiftLeft');
    await waitZ(21);
    const crossed = await page.evaluate(()=>({position:__babylonProbe.hero.position.toArray(),
      blood:__babylonProbe.scene.getObjectByName('SkyPhoto').material.uniforms.blend.value}));
    console.log('gate crossed',crossed.position);
    await waitZ(101);
    const market = await page.evaluate(()=>({position:__babylonProbe.hero.position.toArray(),
      blood:__babylonProbe.scene.getObjectByName('SkyPhoto').material.uniforms.blend.value}));
    console.log('market crossed',market);
    await waitZ(174);
    await page.keyboard.up('ShiftLeft');
    await waitZ(178.8);
    await page.keyboard.up('KeyW');
    console.log('royal threshold reached',await at());
    await page.keyboard.press('KeyF');
    await page.waitForFunction(()=>['DONE','FAILED'].includes(PalaceInterior.state()),null,{timeout:400000,polling:450});
    const palace=await page.evaluate(()=>({state:PalaceInterior.state(),eye:__babylonProbe.hero.position.toArray(),
      exteriorGone:!__babylonProbe.scene.getObjectByName('BabylonExterior'), memory:PalaceInterior.status().postTeardown}));
    await page.waitForFunction(()=>__babylonProbe.frames.at(-1)?.phase==='DONE',null,{timeout:300000,polling:400}).catch(()=>{});
    assert.ok(palace.state==='DONE' && palace.exteriorGone);
    assert.ok(market.blood>.95,'story changed to the authored blood sky');
    report.story={url,walked,crossed,market,palace,errors,requests:downloads.size};
  } finally {
    let frames=[];
    if(!page.isClosed())frames=await page.evaluate(()=>window.__babylonProbe?.frames || []).catch(()=>[]);
    frames.forEach(({jpg},i)=>write('frame-'+String(i).padStart(4,'0')+'.jpg',jpg));
    (report.story ||= {url,errors}).frames=frames.map(({z,phase})=>({z,phase}));
    save();
    await page.close();
  }
}

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    if(!args.includes('--story-only')){
      report.direct.after=await direct(browser,base,'after');save();
      if(baseline){report.direct.before=await direct(browser,baseline,'before');save();}
    }
    if(!args.includes('--no-story'))await story(browser);
    for(const r of [...Object.values(report.direct),...(report.story?[report.story]:[])])assert.deepEqual(r.errors,[]);
  } finally {save();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
