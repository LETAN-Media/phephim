"""Private support database checks; requires a disposable local PostgreSQL database."""
import os,uuid
from urllib.parse import urlsplit
from concurrent.futures import ThreadPoolExecutor
import psycopg
DSN=os.environ.get('COMMUNITY_TEST_DATABASE_URL','')
if urlsplit(DSN).hostname not in ('127.0.0.1','localhost','::1'):raise SystemExit('Requires disposable local database')
def create_user():
 name='sup_'+uuid.uuid4().hex[:12]
 with psycopg.connect(DSN) as c:return c.execute("INSERT INTO users(username,email,password_hash) VALUES(%s,%s,'test') RETURNING id",(name,name+'@example.invalid')).fetchone()[0]
def open_chat(user):
 with psycopg.connect(DSN) as c:return c.execute('SELECT community_support_open(%s)',(user,)).fetchone()[0]
def send(room,user,client,body):
 with psycopg.connect(DSN) as c:return c.execute('SELECT community_support_send(%s,%s,%s,%s)',(room,user,client,body)).fetchone()[0]
a,b,staff=create_user(),create_user(),create_user()
with psycopg.connect(DSN) as c:c.execute("INSERT INTO community_roles(user_id,role) VALUES(%s,'moderator')",(staff,))
with ThreadPoolExecutor(max_workers=4) as pool:ids=list(pool.map(open_chat,[a]*4))
assert len(set(ids))==1
room_a=ids[0];room_b=open_chat(b);assert room_a!=room_b
with psycopg.connect(DSN) as c:assert c.execute('SELECT count(*) FROM community_support_messages WHERE conversation_id=%s AND is_bot',(room_a,)).fetchone()[0]==1
client=uuid.uuid4();assert send(room_a,a,client,'Xin hỗ trợ')['created'];assert not send(room_a,a,client,'Xin hỗ trợ')['created']
assert send(room_a,b,uuid.uuid4(),'Không có quyền')['error']=='not_found'
assert send(room_a,staff,uuid.uuid4(),'Đã tiếp nhận')['created']
assert send(room_b,a,uuid.uuid4(),'Không có quyền')['error']=='not_found'
with psycopg.connect(DSN) as c:c.execute("INSERT INTO community_warning_state(user_id,warning_count,banned_until) VALUES(%s,3,now()+interval '24 hours')",(b,))
assert send(room_b,b,uuid.uuid4(),'Thử khi bị khóa')['error']=='banned'
with psycopg.connect(DSN) as c:
 c.execute("UPDATE community_support_conversations SET status='resolved',updated_at=now()-interval '91 days' WHERE id=%s",(room_a,))
 c.execute("UPDATE community_support_conversations SET status='in_progress',updated_at=now()-interval '91 days' WHERE id=%s",(room_b,))
 c.execute('SELECT community_support_cleanup()')
 assert c.execute('SELECT 1 FROM community_support_conversations WHERE id=%s',(room_a,)).fetchone() is None
 assert c.execute('SELECT 1 FROM community_support_conversations WHERE id=%s',(room_b,)).fetchone()
print('Support PostgreSQL: atomic welcome, isolation, staff access, idempotency, bans and retention passed')
