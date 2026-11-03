"""Destructive integration checks against a dedicated localhost database only."""
import hashlib,json,os,uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit
import psycopg
from psycopg.types.json import Jsonb
DSN=os.environ.get('COMMUNITY_TEST_DATABASE_URL','')
if urlsplit(DSN).hostname not in ('127.0.0.1','localhost','::1'):
    raise SystemExit('Cần database test trên localhost; từ chối database khác.')
policy={'antiSpam':True,'antiAds':True,'antiSolicitation':True,'max10':5,'max60':20,'duplicateSeconds':60}
with psycopg.connect(DSN) as c: room=c.execute("SELECT id FROM community_rooms WHERE slug='cong-dong-chung'").fetchone()[0]
def user():
    name='anti_'+uuid.uuid4().hex[:12]
    with psycopg.connect(DSN) as c:return c.execute("INSERT INTO users(username,email,password_hash) VALUES (%s,%s,'dummy') RETURNING id",(name,name+'@example.test')).fetchone()[0]
def submit(uid,body,reason=None,client=None,norm=None):
    norm=norm if norm is not None else body.lower();client=client or uuid.uuid4()
    h=lambda x:hashlib.sha256(x.encode()).hexdigest()
    with psycopg.connect(DSN) as c:return c.execute('SELECT community_worker_submit_v2(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(room,uid,client,body,reason,None,norm,h(body),h(norm),Jsonb(policy))).fetchone()[0]

def warnings():
    uid=user();ident=uuid.uuid4();first=submit(uid,'Quảng cáo A','advertising',ident)
    assert first['moderation']['warning_count']==1 and first['moderation']['reason']=='advertising'
    assert submit(uid,'Quảng cáo A','advertising',ident)['moderation']['warning_count']==1
    assert submit(uid,'Lôi kéo B','solicitation')['moderation']['warning_count']==2
    third=submit(uid,'Vi phạm C','url')['moderation'];assert third['warning_count']==3 and third['banned_until']
    assert submit(uid,'Tin hợp lệ')['moderation']['banned']
    with psycopg.connect(DSN) as c:
        assert c.execute('SELECT count(*) FROM community_violations WHERE user_id=%s',(uid,)).fetchone()[0]==3
        c.execute("UPDATE community_warning_state SET banned_until=now()-interval '1 second' WHERE user_id=%s",(uid,))
    assert submit(uid,'Sau khi hết hạn')['created']
    with psycopg.connect(DSN) as c:assert c.execute('SELECT warning_count FROM community_warning_state WHERE user_id=%s',(uid,)).fetchone()[0]==0

def rate_limits():
    uid=user()
    with ThreadPoolExecutor(max_workers=8) as pool:result=list(pool.map(lambda n:submit(uid,f'tin {n}'),range(8)))
    assert sum(bool(x.get('created')) for x in result)==5
    assert sum(x.get('error')=='rate' for x in result)==3
    with psycopg.connect(DSN) as c:assert c.execute('SELECT count(*) FROM community_violations WHERE user_id=%s',(uid,)).fetchone()[0]==0
    uid=user()
    with psycopg.connect(DSN) as c:
        for n in range(20):c.execute("INSERT INTO community_messages(room_id,user_id,body,client_id,created_at) VALUES(%s,%s,%s,%s,now()-interval '20 seconds')",(room,uid,f'tin {n}',uuid.uuid4()))
    assert submit(uid,'Tin tiếp theo')['error']=='rate'

def duplication_and_similarity():
    uid=user();assert submit(uid,'Tôi thích bộ phim này')['created']
    ident=uuid.uuid4();assert submit(uid,'Tôi thích bộ phim này',client=ident)['error']=='duplicate'
    assert submit(uid,'Tôi thích bộ phim này',client=ident)['error']=='duplicate'
    assert submit(uid,'Tôi thích bộ phim này')['error']=='duplicate'
    assert submit(uid,'Tôi thích bộ phim này')['error']=='duplicate'
    with psycopg.connect(DSN) as c:
        assert c.execute('SELECT count(*) FROM community_blocked_requests WHERE user_id=%s',(uid,)).fetchone()[0]==3
        c.execute("UPDATE community_blocked_requests SET created_at=now()-interval '6 seconds' WHERE user_id=%s",(uid,))
    assert submit(uid,'Tôi thích bộ phim này')['moderation']['reason']=='spam'
    uid=user()
    for body in ['toi thich xem phim vi co nhieu canh quay dep va nhac hay', 'toi thich xem phim vi co nhieu canh quay dep va nhac tot']:
        assert submit(uid,body)['created']
    assert submit(uid,'toi thich xem phim vi co nhieu canh quay dep va nhac moi')['moderation']['reason']=='spam'

def retention():
    uid=user();now=submit(uid,'Tin cũ để kiểm thử');mid=now['message']['id']
    with psycopg.connect(DSN) as c:
        c.execute("UPDATE community_messages SET created_at=now()-interval '31 days' WHERE id=%s",(mid,))
        bot=c.execute("INSERT INTO community_messages(room_id,is_bot,body,created_at) VALUES (%s,true,'Thông báo ghim',now()-interval '31 days') RETURNING id",(room,)).fetchone()[0]
        c.execute('INSERT INTO community_pins(room_id,message_id) VALUES(%s,%s)',(room,bot))
        assert c.execute('SELECT community_worker_cleanup()').fetchone()[0]>=1
        assert c.execute('SELECT deleted_at IS NOT NULL FROM community_messages WHERE id=%s',(mid,)).fetchone()[0]
        assert c.execute('SELECT body FROM community_messages WHERE id=%s',(bot,)).fetchone()[0]=='Thông báo ghim'

warnings();rate_limits();duplication_and_similarity();retention()
print('PostgreSQL local: cảnh báo 3/3, retry, 5/10s, 20/60s, trùng/gần trùng, hết hạn và bảo vệ tin ghim OK')
