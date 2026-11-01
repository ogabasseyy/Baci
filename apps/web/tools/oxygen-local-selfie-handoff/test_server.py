import base64,importlib.util,os,tempfile,time,unittest
import png,qrcode
os.environ.setdefault('OXYGEN_HANDOFF_ORIGIN_FILE', '/tmp/oxygen-test-origin')
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('handoff',Path(__file__).with_name('server.py'));handoff=importlib.util.module_from_spec(spec);spec.loader.exec_module(handoff)
class HandoffTests(unittest.TestCase):
 def setUp(self):
  handoff.entries.clear();self.tmp=tempfile.TemporaryDirectory();self.file=Path(self.tmp.name)/'origin';self.file.write_text('https://synthetic-test.trycloudflare.com');self.origin=patch.object(handoff,'ORIGIN_FILE',self.file);self.origin.start()
 def tearDown(self):self.origin.stop();self.tmp.cleanup()
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
 def test_reject_untrusted_host(self):
  with self.assertRaises(ValueError):handoff.issue('https://evil.test/',time.time()+100)
 def test_expired_link(self):
  with self.assertRaises(ValueError):handoff.issue('https://'+handoff.HOST+'/',time.time()-1)
 def test_invalid_token(self):
  with self.assertRaises(ValueError):handoff.exchange('bad')
 def test_lifetime_capped(self):
  result=handoff.issue('https://'+handoff.HOST+'/',time.time()+900);self.assertLessEqual(result['expiresAt'],(time.time()+300)*1000)
if __name__=='__main__':unittest.main()
