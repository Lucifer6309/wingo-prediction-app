import http.server
import socketserver
import webbrowser
import os
import sys
import json
import urllib.request
import ssl
import hashlib
import time
import random
from urllib.parse import urlparse, parse_qs

DIRECTORY = os.path.dirname(os.path.abspath(__file__))
API_BASE = 'https://api.api51gameapi.com/api/webapi'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def pz():
    pattern = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx"
    res = []
    for c in pattern:
        if c == 'x':
            res.append(format(random.randint(0, 15), 'x'))
        elif c == 'y':
            res.append(format((random.randint(0, 15) & 3) | 8, 'x'))
        else:
            res.append(c)
    return "".join(res)

def fetch_signed_51game_api(endpoint_path, data):
    t = dict(data)
    t.pop('signature', None)
    t.pop('timestamp', None)
    t['language'] = 0
    t['random'] = pz()

    n = {}
    for k in sorted(t.keys()):
        val = t[k]
        if val is not None and val != "" and k not in ["signature", "track", "xosoBettingData"]:
            n[k] = val

    json_str = json.dumps(n, separators=(',', ':'))
    signature = hashlib.md5(json_str.encode('utf-8')).hexdigest().upper()
    t['signature'] = signature
    t['timestamp'] = int(time.time())

    url = API_BASE + endpoint_path
    payload_bytes = json.dumps(t, separators=(',', ':')).encode('utf-8')

    req = urllib.request.Request(url, data=payload_bytes, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://51gameg.com',
        'Referer': 'https://51gameg.com/',
        'Ar-Origin': 'https://51gameg.com'
    })

    with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
        return json.loads(resp.read().decode('utf-8'))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        
        # Proxy: Get Live Game Issue (Countdown & Current Period)
        if parsed.path == '/api/wingo/issue':
            params = parse_qs(parsed.query)
            type_id = int(params.get('typeId', [30])[0])
            try:
                data = fetch_signed_51game_api('/GetGameIssue', {'typeId': type_id})
                self.send_json_response(200, data)
            except Exception as e:
                self.send_json_response(500, {'code': -1, 'msg': str(e)})
            return

        # Proxy: Get Live Draw History (Supports up to 500 periods)
        if parsed.path == '/api/wingo/history':
            params = parse_qs(parsed.query)
            type_id = int(params.get('typeId', [30])[0])
            page_size = int(params.get('pageSize', [500])[0])
            page_no = int(params.get('pageNo', [1])[0])
            try:
                if page_size > 100:
                    pages_to_fetch = min(5, (page_size + 99) // 100)
                    from concurrent.futures import ThreadPoolExecutor

                    def _fetch(p_num):
                        res = fetch_signed_51game_api('/GetNoaverageEmerdList', {
                            'typeId': type_id,
                            'pageNo': p_num,
                            'pageSize': 100
                        })
                        return p_num, (res.get('data', {}).get('list', []) if res else [])

                    with ThreadPoolExecutor(max_workers=5) as executor:
                        page_results = list(executor.map(_fetch, range(1, pages_to_fetch + 1)))

                    page_results.sort(key=lambda x: x[0])
                    combined = []
                    for _, items in page_results:
                        combined.extend(items)

                    self.send_json_response(200, {
                        'code': 0,
                        'msg': 'Succeed',
                        'data': {
                            'list': combined[:page_size],
                            'totalCount': len(combined)
                        }
                    })
                else:
                    data = fetch_signed_51game_api('/GetNoaverageEmerdList', {
                        'typeId': type_id,
                        'pageNo': page_no,
                        'pageSize': page_size
                    })
                    self.send_json_response(200, data)
            except Exception as e:
                self.send_json_response(500, {'code': -1, 'msg': str(e)})
            return

        # Default static file serving
        return super().do_GET()

    def send_json_response(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def run_server():
    os.chdir(DIRECTORY)
    ports_to_try = [8088, 8089, 8888, 8000, 3000]
    httpd = None
    selected_port = None

    for port in ports_to_try:
        try:
            httpd = socketserver.TCPServer(("", port), CustomHandler)
            selected_port = port
            break
        except OSError:
            continue

    if not httpd:
        print("[!] Could not bind to any standard port. Please close conflicting services.")
        return

    import socket
    local_ip = "localhost"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    with httpd:
        url = f"http://localhost:{selected_port}"
        mobile_url = f"http://{local_ip}:{selected_port}"
        print("=" * 65)
        print(">> WinGo Live Real-Time Multi-Game Studio")
        print(f">> PC Local URL:       {url}")
        print(f">> Android Mobile URL: {mobile_url}")
        print("   (Open this Mobile URL in Chrome on your Android phone!)")
        print(">> Real-Time 51Game API Bridge: ACTIVE (30s, 1Min, 3Min, 5Min)")
        print(">> Android PWA Install: Ready (manifest.json + sw.js)")
        print("Press Ctrl+C to stop the server.")
        print("=" * 65)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    run_server()
