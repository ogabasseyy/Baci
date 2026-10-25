"""Temporary staging-only phone bridge. No storefront proxy or durable identity storage."""
import base64,hashlib,io,json,os,secrets,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import qrcode

HOST='staging.d1l1k5yxed9cvn.amplifyapp.com'
ORIGIN_FILE=Path(os.environ['OXYGEN_HANDOFF_ORIGIN_FILE'])
entries={}
lock=threading.Lock()
SCRIPT="""let token=location.hash.slice(1);history.replaceState(null,'','/selfie');const note=document.querySelector('#note');async function open(){try{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error();const r=await fetch('/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});token='';if(!r.ok)throw Error();const data=await r.json();const target=new URL(data.url);if(target.protocol!=='https:'||target.hostname!=='staging.d1l1k5yxed9cvn.amplifyapp.com')throw Error();location.replace(target.href)}catch{document.querySelector('.spinner').hidden=true;note.textContent='This QR has expired or was already opened. Please refresh it on your laptop and scan again.'}}open();"""
HTML="""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening Oxygen verification</title><style>body{margin:0;background:white;font:16px system-ui;color:#111827;display:grid;min-height:100dvh;place-items:center}main{max-width:320px;margin:24px;text-align:center}p{line-height:1.6;color:#6b7280}.brand{font-size:20px;font-weight:750;color:#dc2626;margin-bottom:32px}.spinner{margin:0 auto 24px;width:28px;height:28px;border:3px solid #fee2e2;border-top-color:#dc2626;border-radius:50%;animation:turn .8s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}</style></head><body><main><div class="brand">Ogabassey</div><div class="spinner" aria-hidden="true"></div><p id="note" role="status">Opening Oxygen’s secure camera…</p></main><script>"""+SCRIPT+"</script></body></html>"

def trusted(url):
 p=urlparse(url)
 return p.scheme=='https' and p.hostname==HOST and not p.username and not p.password and not p.port

def issue(url,expires):
 if not trusted(url):raise ValueError('Invalid handoff')
 now=time.time();expires=min(float(expires),now+300)
 if expires<now+20:raise ValueError('Expired handoff')
 origin=ORIGIN_FILE.read_text().strip()
 if not origin.startswith('https://') or not urlparse(origin).hostname.endswith('.trycloudflare.com'):raise ValueError('Unavailable origin')
 token=secrets.token_urlsafe(32)
 with lock:
  for key in list(entries):
   if entries[key][1]<=now:del entries[key]
  if len(entries)>=32:raise ValueError('Too many handoffs')
  entries[hashlib.sha256(token.encode()).hexdigest()]=(url,expires)
 qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=8,border=4)
 qr.add_data(origin+'/selfie#'+token);qr.make(fit=True)
 out=io.BytesIO();qr.make_image(fill_color='black',back_color='white').save(out,format='PNG')
 return {'qr':'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode(),'expiresAt':int(expires*1000)}

def exchange(token):
 if not isinstance(token,str) or len(token)!=43:raise ValueError('Invalid token')
 with lock: value=entries.pop(hashlib.sha256(token.encode()).hexdigest(),None)
 if not value or value[1]<=time.time():raise ValueError('Expired token')
 return {'url':value[0]}

class Handler(BaseHTTPRequestHandler):
 internal=False
 def log_message(self,*args):pass # Never log bearer fragments, bodies or provider links.
 def reply(self,status,data,html=False):
  body=data.encode() if html else json.dumps(data).encode()
  self.send_response(status)
  self.send_header('Content-Type','text/html; charset=utf-8' if html else 'application/json')
  self.send_header('Content-Length',str(len(body)))
  self.send_header('Cache-Control','no-store')
  self.send_header('Referrer-Policy','no-referrer')
  self.send_header('X-Content-Type-Options','nosniff')
  digest=base64.b64encode(hashlib.sha256(SCRIPT.encode()).digest()).decode()
  self.send_header('Content-Security-Policy',f"default-src 'none'; script-src 'sha256-{digest}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  self.end_headers();self.wfile.write(body)
 def do_GET(self):
  if not self.internal and self.path=='/selfie':return self.reply(200,HTML,True)
  if self.internal and self.path=='/ready':return self.reply(200,{'ready':ORIGIN_FILE.exists()})
  self.reply(404,{'error':'Not found'})
 def do_POST(self):
  if self.path!=('/issue' if self.internal else '/exchange'):return self.reply(404,{'error':'Not found'})
  try:
   size=int(self.headers.get('Content-Length','0'))
   if size<1 or size>(16384 if self.internal else 1024):raise ValueError('Invalid body')
   body=json.loads(self.rfile.read(size))
   data=issue(body['url'],body['expires']) if self.internal else exchange(body.get('token'))
   self.reply(200,data)
  except Exception:self.reply(410,{'error':'Handoff unavailable'})
class Internal(Handler):internal=True
if __name__=='__main__':
 threading.Thread(target=ThreadingHTTPServer(('127.0.0.1',3456),Internal).serve_forever,daemon=True).start()
 print('Restricted selfie bridge: public entry 3455; loopback issuer 3456. No financial actions.',flush=True)
 ThreadingHTTPServer(('127.0.0.1',3455),Handler).serve_forever()
