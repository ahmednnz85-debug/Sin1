"""Force palace entry and watch for 99% Safari-style reload."""
import json
import time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8080/?qa=1&startInHall=1&royalDoorTest=1&metrics=1&checkpoint=0'


def dump(page, label, started):
    data = page.evaluate('''() => {
      const a = window.__probe || {};
      const pi = window.PalaceInterior;
      let pct = null, state = null, notes = [];
      try { state = pi && pi.state ? pi.state() : null; } catch (e) {}
      try { pct = pi && pi.percent ? pi.percent() : null; } catch (e) {}
      try {
        const dbg = document.getElementById('palace-pct');
        if (dbg) pct = parseInt(String(dbg.textContent||'').replace('%',''), 10);
      } catch (e) {}
      const status = (document.getElementById('palace-status')||{}).textContent || '';
      const boot = document.getElementById('boot') || document.getElementById('loading') || document.querySelector('.boot');
      return {
        href: location.href,
        title: document.title,
        state, pct, status,
        pageshow: a.pageshow || 0,
        lost: a.lost || 0,
        restored: a.restored || 0,
        errors: (a.errors || []).slice(-12),
        marks: (a.marks || []).slice(-20),
        bodyText: (document.body && document.body.innerText || '').slice(0, 240)
      };
    }''')
    data['label'] = label
    data['t'] = int(time.time() - started)
    print(json.dumps(data, ensure_ascii=False), flush=True)
    return data


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    )
    context = browser.new_context(
        viewport={'width': 390, 'height': 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    )
    page = context.new_page()
    page.add_init_script('''
      window.__probe = {pageshow:0, lost:0, restored:0, errors:[], marks:[]};
      addEventListener('pageshow', () => { window.__probe.pageshow++; window.__probe.marks.push('pageshow'); });
      addEventListener('webglcontextlost', e => { try{e.preventDefault();}catch(_){} window.__probe.lost++; window.__probe.marks.push('contextlost'); });
      addEventListener('webglcontextrestored', () => { window.__probe.restored++; window.__probe.marks.push('contextrestored'); });
      addEventListener('error', e => window.__probe.errors.push(String(e.message||e)));
      addEventListener('unhandledrejection', e => window.__probe.errors.push('rejection:'+String(e.reason&&e.reason.message||e.reason||e)));
      const _mark = console.info.bind(console);
      console.info = function(){
        try {
          const s = Array.from(arguments).map(String).join(' ');
          if (/palace|warm|99|room-checkpoint|streaming|FAILED|assets/i.test(s)) window.__probe.marks.push(s.slice(0,180));
        } catch(_){}
        return _mark.apply(console, arguments);
      };
    ''')
    started = time.time()
    page.goto(URL, wait_until='domcontentloaded', timeout=120000)
    dump(page, 'dom', started)

    # Dismiss / start game if a start button exists.
    for sel in ['text=ابدأ', 'text=START', 'text=Start', '#start', 'button:has-text("START")', 'button:has-text("ابدأ")', '.start', '#play']:
        try:
            loc = page.locator(sel).first
            if loc.count() and loc.is_visible():
                loc.click(timeout=2000)
                print(json.dumps({'clicked': sel}), flush=True)
                break
        except Exception:
            pass

    # Wait until PalaceInterior exists and game loop is alive.
    ready = False
    for i in range(60):
        time.sleep(2)
        st = dump(page, 'wait-boot-'+str(i), started)
        exists = page.evaluate('() => !!(window.PalaceInterior && window.THREE && window.renderer || window.PalaceInterior)')
        # renderer may be local; check royal door probe / palace API
        exists = page.evaluate('() => !!(window.PalaceInterior && window.__royalDoorTest)')
        if exists:
            ready = True
            break
        if st.get('pageshow', 0) > 1:
            print(json.dumps({'FAIL': 'reload-before-palace', **st}, ensure_ascii=False), flush=True)
            break

    if not ready:
        page.screenshot(path='/opt/cursor/artifacts/palace-99-fail-boot.png')
        print('BOOT_FAILED', flush=True)
        browser.close()
        raise SystemExit(2)

    # Force open door + walk into hall threshold, then release holdSim so ticks run.
    page.evaluate('''() => {
      window.__holdSim = false;
      const t = window.__royalDoorTest;
      if (t && t.place) t.place();
      // Open the royal door if the probe exposes advance/state helpers.
      try {
        if (t && t.advance) {
          for (let i=0;i<180;i++) t.advance(1/60);
        }
      } catch (e) { window.__probe.errors.push('advance:'+e.message); }
      try { if (t && t.cross) t.cross(); } catch (e) { window.__probe.errors.push('cross:'+e.message); }
      window.__holdSim = false;
      return {
        hasTest: !!t,
        state: window.PalaceInterior ? window.PalaceInterior.state() : null
      };
    }''')
    dump(page, 'forced-entry', started)

    # Drive palace ticks by evaluating a burst if needed, but primarily let rAF run.
    final = None
    for i in range(90):
        time.sleep(2)
        # Nudge: ensure doorOpen true via tick context is hard; instead call load path if still IDLE
        page.evaluate('''() => {
          const pi = window.PalaceInterior;
          if (!pi) return null;
          const st = pi.state();
          if (st === 'IDLE' && pi.loadPalaceAssets) {
            // Manual kick: mimic threshold crossing notes via forced start if available
          }
          return st;
        }''')
        st = dump(page, 'entry-'+str(i), started)
        final = st
        if st.get('pageshow', 0) > 1 or st.get('lost', 0) > 0:
            page.screenshot(path='/opt/cursor/artifacts/palace-99-reload.png')
            print(json.dumps({'RESULT': 'RELOAD_OR_CONTEXT_LOST', **st}, ensure_ascii=False), flush=True)
            browser.close()
            raise SystemExit(3)
        if st.get('state') == 'DONE' and (st.get('pct') in (100, None) or st.get('pct') == 100):
            page.screenshot(path='/opt/cursor/artifacts/palace-99-success.png')
            print(json.dumps({'RESULT': 'SUCCESS', **st}, ensure_ascii=False), flush=True)
            browser.close()
            raise SystemExit(0)
        if st.get('state') == 'FAILED':
            page.screenshot(path='/opt/cursor/artifacts/palace-99-failed.png')
            print(json.dumps({'RESULT': 'FAILED_STATE', **st}, ensure_ascii=False), flush=True)
            browser.close()
            raise SystemExit(4)

    page.screenshot(path='/opt/cursor/artifacts/palace-99-timeout.png')
    print(json.dumps({'RESULT': 'TIMEOUT', **(final or {})}, ensure_ascii=False), flush=True)
    browser.close()
    raise SystemExit(5)
