"""Manual Chromium/WebGL residency audit. Start static-server.mjs on port 8080 first."""
import json
import os
import time
from playwright.sync_api import sync_playwright

URL = os.environ.get('SIN1_URL', 'http://127.0.0.1:8080/?debug=1&startInHall=1&royalDoorTest=1')
ROUTE = ['K1', 'K2', 'K3', 'K4', 'L1', 'T1', 'K1']


def snapshot(page):
    return page.evaluate('''() => {
      const a=window.__audit||{}, f=a.frames||[];
      const avg=f.length?f.reduce((x,y)=>x+y,0)/f.length:0;
      const metrics=window.PalaceWings&&PalaceWings.metrics?PalaceWings.metrics():null;
      const perf=window.__perfLab;
      const summary=perf&&perf.summary&&perf.samples.length?perf.summary(perf.samples):null;
      return {
        state:window.PalaceInterior&&PalaceInterior.state?PalaceInterior.state():'missing',
        fps:avg?+(1000/avg).toFixed(2):0,
        debugFps:summary?+summary.fps.toFixed(2):null,
        low1:summary?+summary.low1.toFixed(2):null,
        frameMs:avg?+avg.toFixed(1):(summary?+summary.frameMs.toFixed(1):null),
        updateMs:summary?+summary.update.toFixed(1):null,
        renderMs:summary?+summary.render.toFixed(1):null,
        drawCalls:summary?Math.round(summary.calls):null,
        renderedTriangles:summary?Math.round(summary.tris):null,
        wings:metrics,
        webglLost:a.lost||0,
        pageshow:a.loaded||0,
        errors:a.errors||[]
      };
    }''')


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path='/usr/bin/chromium',
        headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    )
    page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True)
    errors = []
    failed = []
    page.on('console', lambda msg: errors.append({'type': msg.type, 'text': msg.text[:500]}) if msg.type == 'error' else None)
    page.on('pageerror', lambda exc: errors.append({'type': 'pageerror', 'text': str(exc)[:1000]}))
    page.on('requestfailed', lambda req: failed.append({'url': req.url, 'failure': req.failure}))
    page.add_init_script('''
      window.__audit = {frames:[], lost:0, loaded:0, errors:[]};
      addEventListener('pageshow', () => window.__audit.loaded++);
      addEventListener('error', e => window.__audit.errors.push(String(e.message||e)));
      addEventListener('webglcontextlost', () => window.__audit.lost++);
      let last=0, bucket=[];
      function sample(t){ if(last) {bucket.push(t-last); if(bucket.length>120) bucket.shift();} last=t; window.__audit.frames=bucket.slice(); requestAnimationFrame(sample); }
      requestAnimationFrame(sample);
    ''')
    started = time.time()
    try:
        response = page.goto(URL, wait_until='domcontentloaded', timeout=90000)
        print('HTTP', response.status if response else None, flush=True)
        for i in range(25):
            time.sleep(8)
            status = snapshot(page)
            print(json.dumps({'phase':'load','t':int(time.time()-started),**status},ensure_ascii=False),flush=True)
            if status.get('state') == 'DONE':
                break
        if status.get('state') == 'DONE':
            for region in ROUTE:
                arrived = page.evaluate('(id) => PalaceWings.teleport(id)', region)
                page.evaluate('() => { window.__audit.frames=[]; }')
                time.sleep(12)
                status = snapshot(page)
                state_id = page.evaluate('() => PalaceWings.state.current')
                print(json.dumps({'phase':'route','region':region,'arrived':arrived,'current':state_id,'t':int(time.time()-started),**status},ensure_ascii=False),flush=True)
    except Exception as e:
        print('AUDIT_FAILED', repr(e), flush=True)
    print('CONSOLE_ERRORS', json.dumps(errors[-50:], ensure_ascii=False),flush=True)
    print('FAILED_REQUESTS', json.dumps(failed[-30:], ensure_ascii=False),flush=True)
    try: page.screenshot(path='/tmp/sin1-browser-audit.png', full_page=True)
    except Exception as e: print('screenshot failed', str(e),flush=True)
    browser.close()
