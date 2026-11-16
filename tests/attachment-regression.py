"""Run with Python + Playwright and an installed Chromium browser.

  python tests/attachment-regression.py --browser /usr/bin/chromium
Optional --before PATH reproduces the previous ignored-file-input regression.
These fixtures exercise real DOM events, not the logged-in ChatGPT website.
"""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument('--browser', default=None)
args.add_argument('--before', type=Path)
options = args.parse_args()
source = (Path(__file__).resolve().parents[1] / 'content.js').read_text()
image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
html = '''<!doctype html><meta charset="utf-8"><body>
<textarea id="sidebar" placeholder="Search">Sidebar text</textarea>
<input id="unrelated" type="file" accept="image/*" hidden>
<form id="composer-form"><div id="attachments"></div>
<div id="prompt-textarea" contenteditable="true" role="textbox">Existing draft</div>
</form><div id="outside"></div></body>'''
bootstrap = '''()=>{
  window.listeners=[];window.received={paste:0,local:0,unrelated:0,sidebar:0};
  window.chrome={runtime:{id:'test',onMessage:{addListener:f=>listeners.push(f)}},
    storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:()=>{}}}};
  Object.defineProperty(navigator,'clipboard',{value:{write:()=>{throw new Error('Automatic delivery must not change the clipboard')}}});
  window.receive=image=>new Promise(resolve=>listeners[0]({type:'INSERT_IMAGE',image},{id:'test'},resolve));
  window.preview=(file,parent=document.querySelector('#attachments'))=>{
    const img=document.createElement('img');img.src=URL.createObjectURL(file);img.width=64;img.height=64;parent.append(img);
  };
  document.querySelector('#unrelated').addEventListener('change',()=>received.unrelated++);
  document.querySelector('#sidebar').addEventListener('paste',()=>received.sidebar++);
}'''

with sync_playwright() as p:
    launch = {'headless': True}
    if options.browser:
        launch['executable_path'] = options.browser
    browser = p.chromium.launch(**launch)

    def scenario(label, script, code=source, expected=True, method=None):
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html)
        page.evaluate(bootstrap)
        page.evaluate(script)
        page.evaluate(code)
        result = page.evaluate('image=>receive(image)', image)
        assert result['confirmed'] is expected, (label, result)
        if method:
            assert result['method'] == method, (label, result)
        assert page.locator('#prompt-textarea').inner_text() == 'Existing draft'
        assert page.locator('#sidebar').input_value() == 'Sidebar text'
        assert not errors, errors
        stats = page.evaluate('received')
        page.close()
        print('PASS', label, stats, flush=True)
        return stats

    paste_handler = '''()=>document.querySelector('#prompt-textarea').addEventListener('paste',e=>{
        received.paste++;e.preventDefault();preview(e.clipboardData.files[0]);
    })'''
    if options.before:
        before_script = "()=>{document.querySelector('#sidebar').hidden=true;(" + paste_handler + ")();}"
        old = scenario('reproduced: old version ignores working paste when a stale upload input exists',
                       before_script, code=options.before.read_text(), expected=False)
        assert old['paste'] == 0 and old['unrelated'] == 1
    new = scenario('paste reaches the ChatGPT composer despite unrelated upload input and earlier sidebar textarea',
                   paste_handler, method='paste')
    assert new['paste'] == 1 and new['unrelated'] == 0 and new['sidebar'] == 0

    local = scenario('unhandled paste falls back to the input associated with the current form', '''()=>{
      const input=document.createElement('input');input.type='file';input.accept='image/png';input.hidden=true;
      input.addEventListener('change',e=>{received.local++;preview(e.target.files[0])});
      document.querySelector('#composer-form').append(input);
    }''', method='file-input')
    assert local['local'] == 1 and local['unrelated'] == 0

    delayed = scenario('accepted paste waits beyond five seconds without uploading a duplicate', '''()=>{
      document.querySelector('#unrelated').addEventListener('change',e=>preview(e.target.files[0]));
      document.querySelector('#prompt-textarea').addEventListener('paste',e=>{
        received.paste++;e.preventDefault();const file=e.clipboardData.files[0];setTimeout(()=>preview(file),5500);
      });
    }''', method='paste')
    assert delayed['paste'] == 1 and delayed['unrelated'] == 0

    scenario('attachment preview rendered outside the input form is observed', '''()=>{
      document.querySelector('#prompt-textarea').addEventListener('paste',e=>{
        received.paste++;e.preventDefault();const parent=document.createElement('div');
        parent.dataset.testid='attachment-thumbnail';document.querySelector('#outside').append(parent);
        preview(e.clipboardData.files[0],parent);
      });
    }''', method='paste')

    scenario('composer rerender does not detach attachment detection', '''()=>{
      document.querySelector('#prompt-textarea').addEventListener('paste',e=>{
        received.paste++;e.preventDefault();const file=e.clipboardData.files[0];
        setTimeout(()=>{
          const old=document.querySelector('#composer-form'),next=old.cloneNode(true);
          old.replaceWith(next);preview(file,next.querySelector('#attachments'));
        },30);
      });
    }''', method='paste')

    ignored = scenario('multiple unrelated controls are not selected arbitrarily', '''()=>{
      const other=document.createElement('input');other.type='file';other.accept='image/*';other.hidden=true;
      other.addEventListener('change',()=>received.unrelated++);document.body.append(other);
    }''', expected=False, method='paste')
    assert ignored['unrelated'] == 0

    scenario('paste cancellation, hidden input and visible upload button do not count as an attachment', '''()=>{
      document.querySelector('#prompt-textarea').addEventListener('paste',e=>{
        received.paste++;e.preventDefault();
        const hidden=document.createElement('input');hidden.type='file';hidden.hidden=true;
        hidden.dataset.testid='file-upload';document.querySelector('#composer-form').append(hidden);
        const button=document.createElement('button');button.dataset.testid='file-upload-button';
        button.textContent='Upload files';document.querySelector('#composer-form').append(button);
      });
    }''', expected=False, method='paste')
    browser.close()
