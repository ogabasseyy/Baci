import base64,http.client,importlib.util,json,os,tempfile,threading,time,unittest
import png,qrcode
os.environ.setdefault('OXYGEN_HANDOFF_ORIGIN_FILE', '/tmp/oxygen-test-origin')
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('handoff',Path(__file__).with_name('server.py'));handoff=importlib.util.module_from_spec(spec);spec.loader.exec_module(handoff)
class HandoffTests(unittest.TestCase):
 def setUp(self):
  handoff.entries.clear();self.tmp=tempfile.TemporaryDirectory();self.file=Path(self.tmp.name)/'origin';self.file.write_text('https://synthetic-test.trycloudflare.com');self.origin=patch.object(handoff,'ORIGIN_FILE',self.file);self.origin.start();self.allowed=patch.object(handoff,'ALLOWED_ORIGIN','https://synthetic-test.trycloudflare.com');self.allowed.start();self.secret=patch.object(handoff,'ISSUER_SECRET','a'*64);self.secret.start()
 def tearDown(self):self.secret.stop();self.allowed.stop();self.origin.stop();self.tmp.cleanup()
 def test_phone_opens_oxygen_without_an_extra_confirmation_button(self):
  self.assertNotIn('<button',handoff.HTML)
  self.assertIn('location.replace(target.href)',handoff.SCRIPT)
  self.assertIn('open();',handoff.SCRIPT)
  self.assertIn('history.replaceState',handoff.SCRIPT)
 def test_single_use_and_local_qr(self):
  with patch.object(handoff.secrets,'token_urlsafe',return_value='a'*43):result=handoff.issue('https://'+handoff.HOST+'/?token=synthetic',time.time()+120)
  self.assertTrue(result['qr'].startswith('data:image/png;base64,'));self.assertNotIn('synthetic',result['qr']);self.assertEqual(handoff.exchange('a'*43)['url'],'https://'+handoff.HOST+'/?token=synthetic')
  with self.assertRaises(ValueError):handoff.exchange('a'*43)
 def test_qr_is_decodable_png_with_quiet_zone_and_expected_payload(self):
  token='a'*43
  with patch.object(handoff.secrets,'token_urlsafe',return_value=token):result=handoff.issue('https://'+handoff.HOST+'/?token=synthetic',time.time()+120)
  image=base64.b64decode(result['qr'].split(',',1)[1],validate=True)
  width,height,rows,info=png.Reader(bytes=image).read()
  rows=list(rows);self.assertEqual(width,height);self.assertEqual(info['planes'],1)
  expected=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=8,border=4)
  expected.add_data('https://synthetic-test.trycloudflare.com/selfie#'+token);expected.make(fit=True)
  matrix=expected.get_matrix();self.assertEqual(width,len(matrix)*8)
  maximum=(1<<info['bitdepth'])-1
  for y,row in enumerate(rows):
   for x,pixel in enumerate(row):self.assertEqual(pixel,0 if matrix[y//8][x//8] else maximum)
  self.assertTrue(all(pixel==maximum for row in rows[:32] for pixel in row))
  self.assertTrue(all(row[x]==maximum for row in rows for x in range(32)))
 def test_origin_must_match_exact_pin(self):
  for origin in ('https://other.trycloudflare.com','https://synthetic-test.trycloudflare.com/path','https://synthetic-test.trycloudflare.com.evil.test','https://user@synthetic-test.trycloudflare.com'):
   self.file.write_text(origin)
   with self.assertRaises(ValueError):handoff.issue('https://'+handoff.HOST+'/',time.time()+100)
 def test_loopback_issuer_requires_secret(self):
  server=handoff.ThreadingHTTPServer(('127.0.0.1',0),handoff.Internal)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
   conn.request('GET','/ready');self.assertEqual(conn.getresponse().status,403);conn.close()
   for secret,expected in ((None,403),('b'*64,403),('a'*64,200)):
    conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
    headers={'Content-Type':'application/json'}
    if secret:headers['x-oxygen-handoff-secret']=secret
    conn.request('POST','/issue',json.dumps({'url':'https://'+handoff.HOST+'/?token=synthetic','expires':time.time()+100}),headers)
    self.assertEqual(conn.getresponse().status,expected);conn.close()
   self.assertEqual(len(handoff.entries),1)
  finally:server.shutdown();server.server_close();thread.join()
 def test_reject_untrusted_host(self):
  with self.assertRaises(ValueError):handoff.issue('https://evil.test/',time.time()+100)
 def test_expired_link(self):
  with self.assertRaises(ValueError):handoff.issue('https://'+handoff.HOST+'/',time.time()-1)
 def test_invalid_token(self):
  with self.assertRaises(ValueError):handoff.exchange('bad')
 def test_lifetime_capped(self):
  result=handoff.issue('https://'+handoff.HOST+'/',time.time()+900);self.assertLessEqual(result['expiresAt'],(time.time()+300)*1000)
if __name__=='__main__':unittest.main()
