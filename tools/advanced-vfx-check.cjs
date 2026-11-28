#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = argument('--out','/tmp/sin-advanced-vfx');
const base = argument('--url','http://127.0.0.1:3111/index.html');
const record = process.argv.includes('--record');
const width = Number(argument('--width',968));
const THREE = process.env.THREE_DIR;
const entry = '?dev=1&level=VFX-LAB';
fs.mkdirSync(out,{recursive:true});

async function open(browser, phone=false) {
  const context=await browser.newContext({
    viewport:phone?{width:393,height:852}:{width,height:Math.round(width*552/968)},
    deviceScaleFactor:1,hasTouch:phone,isMobile:phone
  });
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>requests.push(new URL(r.url()).pathname));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{
    if(m.type()==='error' && !/favicon/i.test(m.text()))errors.push(m.text().slice(0,1200));
  });
  if (THREE) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\//,route=>route.fulfill({
    path:path.join(THREE,route.request().url().split('three@0.187.0/')[1].split('?')[0]),
    contentType:'text/javascript'
  }));
  return {context,page,requests,errors};
}

async function main() {
  const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const report={runtime:'Chromium / SwiftShader desktop. Mobile is Chromium touch + viewport emulation.',actions:[]};
  try{
    const {page,requests,errors}=await open(browser);
    await page.goto(base+entry);
    await page.waitForFunction(()=>window.__sinDev?.ready||window.__sinDev?.error,null,{timeout:160000,polling:250});
    report.entry=await page.evaluate(()=>({
      ready:__sinDev.ready,sandbox:__sinDev.sandbox,error:__sinDev.error,
      gameSmuggled: Boolean(window.PalaceInterior),prewarm:window.__sinVfxLab?.prewarm,
      assets:window.__sinVfxLab?.snapshot().assets
    }));
    assert.equal(report.entry.ready,true,report.entry.error);
    assert.equal(report.entry.sandbox,true);
    assert.equal(report.entry.gameSmuggled,false);
    assert.equal(requests.some(url=>/\/assets\/.+(?:palace|outdoor|r3\/maw|distant-ruins)/i.test(url)),false);
    report.atlas=await page.evaluate(()=>__sinVfxLab.snapshot().fx.atlases);
    assert.equal(report.atlas.length,3);
    await page.screenshot({path:path.join(out,'lab-desktop.jpg'),quality:91,type:'jpeg'});

    // Exercise the real controls and the shared Developer Hub camera.
    await page.locator('[data-command=play]').click();
    await page.locator('[data-command=pause]').click();
    const tick=await page.evaluate(()=>__sinVfxLab.snapshot().stepCount);
    await page.locator('[data-command=step]').click();
    assert.equal(await page.evaluate(()=>__sinVfxLab.snapshot().stepCount),tick+1);
    await page.locator('#sin-dev-tool button').click();
    await page.locator('[data-t=fly]').click();
    await page.locator('#sin-dev-fly').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#sin-dev-fly').waitFor({state:'detached'});
    await page.locator('[data-command=toggle]').click();
    await page.evaluate(()=>{
      const e=__sinVfxLab;
      e.originalRender=e.renderer.render.bind(e.renderer);
      e.renderer.render=()=>{};
    });
    // Off-screen snapshots use the same renderer, same scene and original WebGL call.
    await page.exposeFunction('saveLabImage',(name,encoded)=>{
      const full=path.join(out,name);
      fs.mkdirSync(path.dirname(full),{recursive:true});
      fs.writeFileSync(full,Buffer.from(encoded,'base64'));
    });
    await page.evaluate(()=>{
      const e=__sinVfxLab;
      e.sampleDraw=(name,view)=>{
        e.setView(view);
        const canvas=e.renderer.domElement;
        const start=performance.now();
        e.originalRender(e.scene,e.camera);
        if(name) saveLabImage(name,canvas.toDataURL('image/jpeg',.89).split(',')[1]);
        return {ms:performance.now()-start,draw:{...e.renderer.info.render},memory:{...e.renderer.info.memory}};
      };
    });
    const sampledSpeed=async speed=>{
      await page.evaluate(speed=>{
        __sinVfxLab.settings({quality:'medium',speed});
        __sinVfxLab.play('GUARDIAN_CHEST_SEAL_CHARGE');
      },speed);
      await page.waitForTimeout(420);
      return page.evaluate(()=>{
        __sinVfxLab.pause(true);
        return __sinVfxLab.snapshot().time;
      });
    };
    report.clock={normal:await sampledSpeed(1),slow:await sampledSpeed(.3)};
    assert.ok(report.clock.normal>report.clock.slow*2 && report.clock.slow>0,'slow playback is driven by the same clock');
    const ids=await page.evaluate(()=>__sinVfxLab.effectIds);
    assert.equal(ids.length,20);
    for(const id of ids){
      const outcome=await page.evaluate(id=>{
        const e=__sinVfxLab;
        e.settings({quality:'medium',speed:.3});
        e.play(id);
        const before=e.snapshot().stepCount;
        const max={sparks:0,dust:0,rocks:0,decals:0,ribbons:0,edges:0};
        let wave=false, peak=0, total=-1;
        const marker=[];
        for(let time=0;time<720;time+=3){
          e.step(3);
          const snap=e.snapshot(), f=snap.fx;
          max.sparks=Math.max(max.sparks,f.activeSparks);
          max.dust=Math.max(max.dust,f.activeDust);
          max.rocks=Math.max(max.rocks,f.rocks);
          max.decals=Math.max(max.decals,f.cracks);
          max.ribbons=Math.max(max.ribbons,f.activeRibbons);
          max.edges=Math.max(max.edges,f.activeEdges);
          wave||=f.wave;
          const score=f.activeSparks*.35+f.activeDust+f.rocks*.32+Number(f.wave)*8+f.activeRibbons*7+f.activeEdges;
          if(score>total){total=score;peak=time+3;}
          if(snap.done){marker.push(...snap.contacts);break;}
        }
        e.play(id);
        e.step(peak);
        const frame=e.snapshot();
        const angles=['oblique','reverse','top'];
        e.sampleDraw('still/'+id+'.jpg',angles[0]);
        e.sampleDraw(null,angles[1]);
        e.sampleDraw(null,angles[2]);
        if(['SIN_AXE_PARRY','GUARDIAN_STAFF_LEAP_SLAM','SIN_AXE_LIGHT_TRAIL',
          'GUARDIAN_STAFF_CROWN_IMPACT','GUARDIAN_CHEST_SEAL_CHARGE'].includes(id)) {
          e.sampleDraw('angles/'+id+'-rear.jpg',angles[1]);
        }
        return {id, max,wave,peak, marker,duration:frame.time,stepCount:frame.stepCount-before,
          memory:frame.memory,draw:frame.draw,visible:total>0};
      },id);
      assert.equal(outcome.visible,true,id);
      if(!/LIGHT_TRAIL|HEAVY_TRAIL|SIN_AXE_CHARGE/.test(id))assert.ok(outcome.marker.length>=1,id);
      if(id==='SIN_AXE_COMBO_TRAIL')assert.equal(outcome.marker.length,3);
      report.actions.push(outcome);
      console.log(id, 'markers',outcome.marker.length,'peak',outcome.peak,JSON.stringify(outcome.max));
    }

    report.team=await page.evaluate(()=>{
      const e=__sinVfxLab;
      e.settings({quality:'low',speed:1});e.demo();
      for(let i=0;i<8&&!e.snapshot().done;i++)e.step(720);
      const demo=e.snapshot();
      e.settings({surface:'wall',quality:'medium'});
      e.play('SIN_AXE_GROUND_IMPACT');e.step(480);
      const wall=e.snapshot();
      e.settings({surface:'metal',quality:'medium'});
      e.play('SIN_AXE_METAL_IMPACT');e.step(480);
      const metal=e.snapshot();
      e.settings({surface:'auto'});
      return {demo,wall,metal};
    });
    assert.ok(report.team.demo.done&&report.team.demo.hitCount>=9,'demo should reach final and use physical markers');
    assert.equal(report.team.metal.contacts[0]?.surface,'metal');
    assert.equal(report.team.wall.contacts[0]?.surface,'wall');

    report.perf=await page.evaluate(()=>{
      const e=__sinVfxLab, ms=[],drawIds=[];
      const run=(setting,frames=213)=>{
        e.settings({quality:setting});
        e.play('GUARDIAN_STAFF_GROUND_SLAM');e.step(frames);
        e.sampleDraw(null,'oblique');
        return e.snapshot();
      };
      const initial=e.snapshot();
      const high=run('high'),low=run('low');
      const before={...e.renderer.info.memory};
      const begin=performance.now();
      for(let i=0;i<14;i++){
        e.settings({quality:i%2?'low':'high'});
        e.play('GUARDIAN_STAFF_GROUND_SLAM');e.step(213);
        drawIds.push(e.snapshot().fx.activeSparks);
      }
      const simulationMs=performance.now()-begin;
      e.step(640);
      const after=e.sampleDraw(null,'oblique');
      const estimates=SinProcessMemory.estimate({scene:e.scene,renderer:e.renderer,phase:'VFX-LAB'});
      for(let i=0;i<8;i++)ms.push(e.sampleDraw(null,'oblique').ms);
      return {simulationMs,fixedSteps:14*213,initial:initial.memory,high,low,before,
        after,estimates,renderSubmitMs:ms,churn:drawIds,rest:e.snapshot().fx};
    });
    assert.deepEqual(report.perf.before,report.perf.after.memory);
    assert.equal(report.perf.rest.activeSparks,0);
    assert.equal(report.perf.rest.activeDust,0);
    assert.ok(report.perf.high.fx.activeDust >= report.perf.low.fx.activeDust);
    report.frameIntervals=await page.evaluate(async ()=>{
      const e=__sinVfxLab;
      const measure=()=>new Promise(resolve=>{
        const intervals=[];
        let stamp=0;
        const sample=now=>{
          if(stamp) intervals.push(+(now-stamp).toFixed(2));
          stamp=now;
          if(intervals.length===12) resolve(intervals);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      e.settings({quality:'medium'});
      SinDevHub.respawn();
      e.renderer.render=e.originalRender;
      const idle=await measure();
      e.play('GUARDIAN_STAFF_GROUND_SLAM');e.step(192);
      const active=await measure();
      e.renderer.render=()=>{};
      return {idle,active};
    });
    fs.writeFileSync(path.join(out,'report-progress.json'),JSON.stringify(report,null,2));

    if(record){
      const scenes={
        sin:['SIN_AXE_LIGHT_TRAIL','SIN_AXE_HEAVY_TRAIL','SIN_AXE_COMBO_TRAIL','SIN_AXE_LUNAR_BURST','SIN_AXE_PARRY'],
        guardian:['GUARDIAN_STAFF_BLADE_IMPACT','GUARDIAN_STAFF_CROWN_IMPACT','GUARDIAN_STAFF_GROUND_SLAM',
          'GUARDIAN_STAFF_LEAP_SLAM','GUARDIAN_SPIRITUAL_BURST','GUARDIAN_ENRAGED_AURA']
      };
      for(const [group,names] of Object.entries(scenes)){
        const frames=await page.evaluate(({group,names})=>{
          const e=__sinVfxLab,frameInfo=[];
          let i=0;
          for(const id of names){
            e.settings({quality:'medium',speed:.5});
            e.play(id);
            const start=i;
            for(let n=0;n<(id.includes('COMBO')?46:28);n++){
              e.step(14);
              const view=id.includes('LEAP_SLAM')||id.includes('ENRAGED_AURA')?'oblique':'close';
              e.sampleDraw('film/'+group+'/frame'+String(i++).padStart(5,'0')+'.jpg',view);
              if(e.snapshot().done)break;
            }
            frameInfo.push({id,start,end:i});
          }
          return frameInfo;
        },{group,names});
        report[group+'Film']=frames;
        fs.writeFileSync(path.join(out,'report-progress.json'),JSON.stringify(report,null,2));
      }
      report.duelFilm=await page.evaluate(()=>{
        const e=__sinVfxLab;
        e.settings({quality:'medium',speed:1});e.demo();
        const frames=[];
        for(let frame=0;frame<188&&!e.snapshot().done;frame++){
          e.step(22);
          const view=frame>128?'oblique':frame>72?'top':'oblique';
          e.sampleDraw('film/duel/frame'+String(frame).padStart(5,'0')+'.jpg',view);
          frames.push(e.snapshot().clip);
        }
        if(!e.snapshot().done) throw new Error('Film ended before the combat sequence');
        return frames;
      });
    }
    report.requests=[...new Set(requests.filter(url=>/\/(?:assets|vfx-lab)\//.test(url)))];
    report.errors=errors;
    assert.deepEqual(errors,[]);
    await page.context().close();

    const phone=await open(browser,true);
    await phone.page.goto(base+entry);
    await phone.page.waitForFunction(()=>window.__sinDev?.ready||window.__sinDev?.error,null,{timeout:160000,polling:250});
    await phone.page.locator('[data-command=play]').tap();
    await phone.page.locator('[data-command=pause]').tap();
    await phone.page.locator('[data-command=step]').tap();
    report.phone=await phone.page.evaluate(()=>({ready:__sinDev.ready,state:__sinVfxLab.snapshot().paused,width:innerWidth}));
    assert.equal(report.phone.state,true);
    await phone.page.screenshot({path:path.join(out,'lab-phone.jpg'),quality:88,type:'jpeg'});
    assert.deepEqual(phone.errors,[]);
    await phone.context.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log('PASS',ids.length,'presets',report.team.demo.hitCount,'demo contacts');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
