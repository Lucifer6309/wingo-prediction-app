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

    with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
        return json.loads(resp.read().decode('utf-8'))

import threading

class HistoryManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = {}
        self.issue_cache = {}
        self.updating_issues = set()
        self.updating_history = set()

    def _fetch_issue_sync(self, type_id):
        now = time.time()
        try:
            data = fetch_signed_51game_api('/GetGameIssue', {'typeId': type_id})
            if data and data.get('code') == 0:
                with self.lock:
                    self.issue_cache[type_id] = {'data': data, 'time': now}
                return data
        except Exception as e:
            with self.lock:
                if type_id in self.issue_cache:
                    return self.issue_cache[type_id]['data']
            print(f"[!] Issue fetch exception: {e}")
            now_dt = time.gmtime(time.time() + 19800) # IST
            period_suffix = int(time.time()) // (30 if type_id == 30 else 60)
            return {
                'code': 0,
                'msg': 'Succeed',
                'data': {
                    'issueNumber': f"{now_dt.tm_year}{now_dt.tm_mon:02d}{now_dt.tm_mday:02d}10005{period_suffix % 10000:04d}",
                    'startTime': time.strftime("%Y-%m-%d %H:%M:%S", now_dt),
                    'endTime': time.strftime("%Y-%m-%d %H:%M:%S", now_dt)
                }
            }
        return {'code': 0, 'msg': 'Fallback', 'data': {'issueNumber': 'Loading...'}}

    def _refresh_issue_worker(self, type_id):
        try:
            self._fetch_issue_sync(type_id)
        finally:
            with self.lock:
                self.updating_issues.discard(type_id)

    def get_issue(self, type_id):
        now = time.time()
        with self.lock:
            cached = self.issue_cache.get(type_id)
        
        # Fresh RAM response (< 2.5s)
        if cached and (now - cached['time'] < 2.5):
            return cached['data']

        # Stale-While-Revalidate: Return cached RAM instantly (< 0.2ms) & refresh in background
        if cached and (now - cached['time'] < 25.0):
            with self.lock:
                if type_id not in self.updating_issues:
                    self.updating_issues.add(type_id)
                    threading.Thread(target=self._refresh_issue_worker, args=(type_id,), daemon=True).start()
            return cached['data']

        # Cold start fallback
        return self._fetch_issue_sync(type_id)

    def _fetch_history_sync(self, type_id, page_size=1000, page_no=1):
        with self.lock:
            if type_id not in self.cache:
                self.cache[type_id] = {
                    'list': [],
                    'last_fetch': 0,
                    'is_backfilling': False
                }
            entry = self.cache[type_id]

        try:
            fresh_res = fetch_signed_51game_api('/GetNoaverageEmerdList', {
                'typeId': type_id,
                'pageNo': 1,
                'pageSize': 100
            })
            if fresh_res and fresh_res.get('code') == 0:
                fresh_list = fresh_res.get('data', {}).get('list', [])
                with self.lock:
                    entry['last_fetch'] = time.time()
                    if not entry['list']:
                        entry['list'] = fresh_list
                    else:
                        existing_issues = {x['issueNumber'] for x in entry['list']}
                        new_draws = [x for x in fresh_list if x['issueNumber'] not in existing_issues]
                        if new_draws:
                            entry['list'] = new_draws + entry['list']
                            seen = set()
                            unique_list = []
                            for it in entry['list']:
                                if it['issueNumber'] not in seen:
                                    seen.add(it['issueNumber'])
                                    unique_list.append(it)
                            entry['list'] = sorted(unique_list, key=lambda x: str(x['issueNumber']), reverse=True)[:600]

                    if len(entry['list']) < 550 and not entry['is_backfilling'] and page_size > 100:
                        entry['is_backfilling'] = True
                        threading.Thread(target=self._backfill_worker, args=(type_id,), daemon=True).start()
        except Exception as e:
            print(f"[!] Upstream history error: {e}. Serving {len(entry['list'])} cached records.")
            with self.lock:
                entry['last_fetch'] = time.time()
            if entry['list']:
                return self._format_response(entry['list'], page_size, page_no)
            raise e

        return self._format_response(entry['list'], page_size, page_no)

    def _refresh_history_worker(self, type_id, page_size=1000):
        try:
            self._fetch_history_sync(type_id, page_size, 1)
        finally:
            with self.lock:
                self.updating_history.discard(type_id)

    def get_history(self, type_id, page_size=1000, page_no=1):
        now = time.time()
        with self.lock:
            if type_id not in self.cache:
                self.cache[type_id] = {
                    'list': [],
                    'last_fetch': 0,
                    'is_backfilling': False
                }
            entry = self.cache[type_id]

        # If RAM cache exists:
        if len(entry['list']) > 0:
            # Fresh within 2.8s: return immediately
            if now - entry['last_fetch'] < 2.8 or entry.get('is_backfilling', False):
                return self._format_response(entry['list'], page_size, page_no)

            # Stale-While-Revalidate: Return current RAM data immediately (< 0.2ms) & refresh in background
            with self.lock:
                if type_id not in self.updating_history:
                    self.updating_history.add(type_id)
                    threading.Thread(target=self._refresh_history_worker, args=(type_id, page_size), daemon=True).start()

            return self._format_response(entry['list'], page_size, page_no)

        # Cold start (first request ever)
        return self._fetch_history_sync(type_id, page_size, page_no)

    def _backfill_worker(self, type_id):
        try:
            for p_num in range(2, 7):
                time.sleep(0.3)
                try:
                    res = fetch_signed_51game_api('/GetNoaverageEmerdList', {
                        'typeId': type_id,
                        'pageNo': p_num,
                        'pageSize': 100
                    })
                    if res and res.get('code') == 0:
                        items = res.get('data', {}).get('list', [])
                        if not items:
                            break
                        with self.lock:
                            entry = self.cache.get(type_id)
                            if entry:
                                existing_issues = {x['issueNumber'] for x in entry['list']}
                                new_draws = [x for x in items if x['issueNumber'] not in existing_issues]
                                entry['list'].extend(new_draws)
                                seen = set()
                                unique_list = []
                                for it in entry['list']:
                                    if it['issueNumber'] not in seen:
                                        seen.add(it['issueNumber'])
                                        unique_list.append(it)
                                entry['list'] = sorted(unique_list, key=lambda x: str(x['issueNumber']), reverse=True)[:600]
                except Exception as ex:
                    print(f"Backfill page {p_num} skipped: {ex}")
                    time.sleep(1.0)
        finally:
            with self.lock:
                entry = self.cache.get(type_id)
                if entry:
                    entry['is_backfilling'] = False
            print(f">> Backfill complete for typeId {type_id}: {len(self.cache[type_id]['list'])} historical draws ready.")

    def _format_response(self, full_list, page_size, page_no):
        start = (page_no - 1) * page_size
        end = start + page_size
        slice_data = full_list[start:end] if page_size < len(full_list) else full_list[:page_size]
        return {
            'code': 0,
            'msg': 'Succeed',
            'data': {
                'list': slice_data,
                'totalCount': len(full_list)
            }
        }

history_mgr = HistoryManager()

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
                data = history_mgr.get_issue(type_id)
                self.send_json_response(200, data)
            except Exception as e:
                self.send_json_response(200, {'code': 0, 'msg': 'Fallback', 'data': {'issueNumber': 'Loading...'}})
            return

        # Proxy: Get Live Draw History (Supports up to 600 periods)
        if parsed.path == '/api/wingo/history':
            params = parse_qs(parsed.query)
            type_id = int(params.get('typeId', [30])[0])
            page_size = int(params.get('pageSize', [600])[0])
            page_no = int(params.get('pageNo', [1])[0])
            try:
                data = history_mgr.get_history(type_id, page_size, page_no)
                self.send_json_response(200, data)
            except Exception as e:
                self.send_json_response(200, {'code': 0, 'msg': 'Empty', 'data': {'list': [], 'totalCount': 0}})
            return

        # Default static file serving
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/client-error':
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)
            err_text = post_body.decode('utf-8', errors='ignore')
            print(f"\n[!] BROWSER ERROR REPORTED: {err_text}\n", flush=True)
            try:
                with open(os.path.join(DIRECTORY, "client_errors.log"), "a", encoding="utf-8") as f:
                    f.write(err_text + "\n")
            except Exception:
                pass
            self.send_json_response(200, {'ok': True})
            return
        self.send_response(404)
        self.end_headers()

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
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

def run_server():
    os.chdir(DIRECTORY)
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            ports_to_try = [int(env_port)]
        except ValueError:
            ports_to_try = [8088, 8089, 8888, 8000, 3000]
    else:
        ports_to_try = [8088, 8089, 8888, 8000, 3000]
    httpd = None
    selected_port = None

    for port in ports_to_try:
        try:
            httpd = ThreadedTCPServer(("", port), CustomHandler)
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
        print(">> Analysis Engine: 600 Historical Periods / 300-Round Audit")
        print(">> Android PWA Install: Ready (manifest.json + sw.js)")
        print("Press Ctrl+C to stop the server.")
        print("=" * 65)
        # Only launch browser if running locally (not in cloud/headless environment)
        if not os.environ.get("PORT") and not os.environ.get("RENDER") and not os.environ.get("RAILWAY_ENVIRONMENT"):
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
