#!/usr/bin/env python3
"""
库存管理系统 - 后端服务器 (Python + SQLite)
=============================================
- 纯 Python 内置库，无需 pip install
- SQLite 持久化存储，不怕清浏览器缓存
- REST API + 静态文件服务
- 支持局域网多设备同时访问
"""

import http.server
import json
import sqlite3
import os
import hashlib
import uuid
import urllib.parse
import mimetypes
import shutil

PORT = 8765
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 数据库文件：放用户目录（避免某些环境对程序目录的写入限制）
DB_FILE = os.path.join(os.path.expanduser('~'), 'inventory.db')
TOKENS = {}  # 内存 token -> username 映射

# =============================================================
# 数据库初始化
# =============================================================
def init_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.executescript('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            createdAt TEXT,
            updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoryId INTEGER DEFAULT 0,
            name TEXT NOT NULL,
            spec TEXT DEFAULT '',
            unit TEXT DEFAULT '',
            unitPrice REAL DEFAULT 0,
            quantity REAL DEFAULT 0,
            minQuantity REAL DEFAULT 0,
            location TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            createdAt TEXT,
            updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            itemId INTEGER NOT NULL,
            quantity REAL DEFAULT 0,
            unitPrice REAL DEFAULT 0,
            totalPrice REAL DEFAULT 0,
            operator TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            createdAt TEXT,
            updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checkDate TEXT,
            status TEXT DEFAULT 'completed',
            items TEXT DEFAULT '[]',
            createdAt TEXT,
            updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            displayName TEXT DEFAULT '',
            role TEXT DEFAULT 'viewer',
            createdAt TEXT,
            updatedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            content TEXT,
            createdAt TEXT,
            updatedAt TEXT
        );
    ''')

    # 首次运行创建默认管理员
    row = c.execute("SELECT COUNT(*) FROM users").fetchone()
    if row[0] == 0:
        pwd = hashlib.sha256('admin123'.encode()).hexdigest()
        c.execute("INSERT INTO users (username, password, displayName, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)",
                  ('admin', pwd, '管理员', 'admin', _now(), _now()))
        print('✅ 默认管理员已创建 (admin / admin123)')

    conn.commit()
    conn.close()
    print(f'✅ SQLite 数据库已就绪: {DB_FILE}')

    # 升级兼容：给旧表补 updatedAt 列
    conn = sqlite3.connect(DB_FILE)
    for t in ['transactions', 'checks', 'templates']:
        try: conn.execute(f"ALTER TABLE {t} ADD COLUMN updatedAt TEXT")
        except: pass
    conn.commit()
    conn.close()

def _now():
    from datetime import datetime
    return datetime.now().isoformat()

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# =============================================================
# 密码工具
# =============================================================
def hash_pw(password):
    return hashlib.sha256(password.encode()).hexdigest()

# =============================================================
# HTTP 请求处理
# =============================================================
class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # 精简日志
        if args[0] != '200':
            print(f"[{self.address_string()}] {args[0]} {args[1]}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        # API 路由
        if path.startswith('/api/'):
            self.handle_api('GET', path, params, None)
            return

        # 静态文件
        if path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len > 0 else b'{}'
        try:
            data = json.loads(body) if body else {}
        except:
            data = {}
        self.handle_api('POST', self.path, {}, data)

    def do_PUT(self):
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len > 0 else b'{}'
        try:
            data = json.loads(body) if body else {}
        except:
            data = {}
        self.handle_api('PUT', self.path, {}, data)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        self.handle_api('DELETE', parsed.path, params, None)

    # ==========================================================
    # API 路由分发
    # ==========================================================
    def handle_api(self, method, path, params, data):
        try:
            # 登录不需要 token
            if path == '/api/login' and method == 'POST':
                return self._login(data)

            # 其他 API 需要 token 认证
            if not self._check_auth():
                self._send_json({'error': '未登录或登录已过期'}, 401)
                return

            # 路由表
            routes = {
                ('GET', '/api/stats/dashboard'):     self._stats_dashboard,
                ('GET', '/api/users'):               lambda: self._list('users'),
                ('POST', '/api/users'):              lambda: self._create('users', data, ['username','password','role']),
                ('PUT', '/api/users'):               lambda: self._update('users', data),
                ('DELETE', '/api/users'):            lambda: self._delete('users', params),
                ('GET', '/api/categories'):          lambda: self._list('categories'),
                ('POST', '/api/categories'):         lambda: self._create('categories', data, ['name']),
                ('PUT', '/api/categories'):          lambda: self._update('categories', data),
                ('DELETE', '/api/categories'):       lambda: self._delete('categories', params),
                ('GET', '/api/items'):               lambda: self._list('items'),
                ('POST', '/api/items'):              lambda: self._create('items', data, ['name']),
                ('PUT', '/api/items'):               lambda: self._update('items', data),
                ('DELETE', '/api/items'):            lambda: self._delete('items', params),
                ('GET', '/api/transactions'):        lambda: self._list('transactions'),
                ('POST', '/api/transactions'):       lambda: self._create('transactions', data, ['type','itemId']),
                ('GET', '/api/checks'):              lambda: self._list('checks'),
                ('POST', '/api/checks'):             lambda: self._create('checks', data, []),
                ('GET', '/api/export'):              self._export_all,
                ('POST', '/api/import'):             lambda: self._import_all(data),
                ('POST', '/api/clear'):              self._clear_all,
                ('GET', '/api/check'):               lambda: self._check_item(params),
            }

            handler = routes.get((method, path))
            if handler:
                handler()
            else:
                self._send_json({'error': '接口不存在'}, 404)

        except Exception as e:
            print(f"❌ API 错误: {e}")
            self._send_json({'error': str(e)}, 500)

    # ==========================================================
    # 认证
    # ==========================================================
    def _check_auth(self):
        token = self.headers.get('Authorization', '').replace('Bearer ', '')
        return token in TOKENS

    def _login(self, data):
        username = data.get('username', '')
        password = data.get('password', '')
        conn = get_db()
        row = conn.execute("SELECT * FROM users WHERE username=? AND password=?",
                          (username, hash_pw(password))).fetchone()
        conn.close()

        if row:
            token = str(uuid.uuid4())
            TOKENS[token] = {'id': row['id'], 'username': row['username'],
                             'displayName': row['displayName'], 'role': row['role']}
            self._send_json({
                'token': token,
                'user': {'id': row['id'], 'username': row['username'],
                         'displayName': row['displayName'], 'role': row['role']}
            })
        else:
            self._send_json({'error': '用户名或密码错误'}, 401)

    # ==========================================================
    # CRUD 通用
    # ==========================================================
    def _list(self, table):
        conn = get_db()
        rows = conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
        conn.close()
        self._send_json([dict(r) for r in rows])

    def _create(self, table, data, required):
        for field in required:
            if field not in data:
                self._send_json({'error': f'缺少必填字段: {field}'}, 400)
                return
        now = _now()
        if 'createdAt' not in data: data['createdAt'] = now
        if 'updatedAt' not in data: data['updatedAt'] = now
        # 密码需要哈希
        if 'password' in data:
            data['password'] = hash_pw(data['password'])

        fields = list(data.keys())
        placeholders = ','.join(['?' for _ in fields])
        cols = ','.join(fields)
        values = [data[f] for f in fields]

        conn = get_db()
        try:
            cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", values)
            conn.commit()
            new_id = cur.lastrowid
            row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (new_id,)).fetchone()
            self._send_json(dict(row), 201)
        except Exception as e:
            conn.close()
            self._send_json({'error': str(e)}, 400)
            return
        conn.close()

    def _update(self, table, data):
        if 'id' not in data:
            self._send_json({'error': '缺少 id'}, 400)
            return
        data['updatedAt'] = _now()
        if 'password' in data:
            data['password'] = hash_pw(data['password'])

        fields = [k for k in data.keys() if k != 'id']
        values = [data[k] for k in fields] + [data['id']]
        set_clause = ','.join([f"{k}=?" for k in fields])

        conn = get_db()
        conn.execute(f"UPDATE {table} SET {set_clause} WHERE id=?", values)
        conn.commit()
        row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (data['id'],)).fetchone()
        conn.close()
        if row:
            self._send_json(dict(row))
        else:
            self._send_json({'error': '未找到'}, 404)

    def _delete(self, table, params):
        ids = params.get('id', [])
        if not ids:
            self._send_json({'error': '缺少 id 参数'}, 400)
            return
        id_val = int(ids[0])
        conn = get_db()
        conn.execute(f"DELETE FROM {table} WHERE id=?", (id_val,))
        conn.commit()
        conn.close()
        self._send_json({'success': True})

    # ==========================================================
    # 特殊接口
    # ==========================================================
    def _stats_dashboard(self):
        conn = get_db()
        items = conn.execute("SELECT * FROM items").fetchall()
        txns = conn.execute("SELECT * FROM transactions").fetchall()
        conn.close()

        total_items = len(items)
        total_qty = sum(i['quantity'] or 0 for i in items)
        total_value = sum((i['quantity'] or 0) * (i['unitPrice'] or 0) for i in items)
        low_stock = [dict(i) for i in items if (i['quantity'] or 0) <= (i['minQuantity'] or 0)]
        today = _now()[:10]
        today_txns = [dict(t) for t in txns if (t['createdAt'] or '')[:10] == today]

        recent = sorted(txns, key=lambda t: t['createdAt'] or '', reverse=True)[:10]

        self._send_json({
            'totalItems': total_items,
            'totalQty': total_qty,
            'totalValue': round(total_value, 2),
            'lowStock': [dict(i) for i in low_stock],
            'todayTxns': len(today_txns),
            'recentTxns': [dict(t) for t in recent]
        })

    def _export_all(self):
        conn = get_db()
        tables = ['categories', 'items', 'transactions', 'checks', 'users', 'templates']
        data = {}
        for t in tables:
            rows = conn.execute(f"SELECT * FROM {t}").fetchall()
            data[t] = [dict(r) for r in rows]
        conn.close()
        self._send_json(data)

    def _import_all(self, data):
        conn = get_db()
        for table, rows in data.items():
            if not rows: continue
            # 检查表是否存在
            try:
                conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
            except:
                continue
            conn.execute(f"DELETE FROM {table}")
            for row in rows:
                fields = list(row.keys())
                placeholders = ','.join(['?' for _ in fields])
                cols = ','.join(fields)
                values = [row[f] for f in fields]
                try:
                    conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", values)
                except:
                    pass
        conn.commit()
        conn.close()
        self._send_json({'success': True})

    def _clear_all(self):
        conn = get_db()
        for t in ['categories', 'items', 'transactions', 'checks', 'users', 'templates']:
            conn.execute(f"DELETE FROM {t}")
        conn.commit()
        conn.close()
        self._send_json({'success': True})

    def _check_item(self, params):
        id_val = params.get('itemId', [None])[0]
        qty = float(params.get('quantity', [0])[0])
        if not id_val:
            self._send_json({'error': '缺少 itemId'}, 400)
            return
        conn = get_db()
        row = conn.execute("SELECT quantity FROM items WHERE id=?", (id_val,)).fetchone()
        conn.close()
        if not row:
            self._send_json({'error': '物品不存在'}, 404)
            return
        if qty > (row['quantity'] or 0):
            self._send_json({'available': False, 'current': row['quantity']})
        else:
            self._send_json({'available': True, 'current': row['quantity']})

    # ==========================================================
    # 响应辅助
    # ==========================================================
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

# =============================================================
# 启动
# =============================================================
if __name__ == '__main__':
    init_db()
    server = http.server.HTTPServer(('0.0.0.0', PORT), RequestHandler)
    print('=' * 50)
    print('  库存管理系统 - 服务端模式')
    print('=' * 50)
    print(f'  本机访问:  http://localhost:{PORT}')
    # 获取本机IP
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        print(f'  局域网:    http://{ip}:{PORT}')
    except:
        pass
    print(f'  数据文件:  {DB_FILE}')
    print('  Ctrl+C 停止服务')
    print('=' * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止')
        server.server_close()