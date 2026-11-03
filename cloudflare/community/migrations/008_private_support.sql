BEGIN;
CREATE TABLE community_support_conversations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_user_message_at timestamptz,
 last_staff_message_at timestamptz
);
CREATE INDEX community_support_status_idx ON community_support_conversations(status,updated_at DESC);
CREATE TABLE community_support_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id bigint NOT NULL REFERENCES community_support_conversations(id) ON DELETE CASCADE,
 author_id bigint REFERENCES users(id) ON DELETE SET NULL,
 is_bot boolean NOT NULL DEFAULT false,
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
 client_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((is_bot AND author_id IS NULL AND client_id IS NULL) OR (NOT is_bot AND client_id IS NOT NULL)),
 UNIQUE(author_id,client_id)
);
CREATE INDEX community_support_messages_history_idx ON community_support_messages(conversation_id,id DESC);
CREATE TABLE community_support_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id bigint NOT NULL REFERENCES community_support_conversations(id) ON DELETE CASCADE,
 actor_id bigint NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('in_progress','resolved','open')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION community_support_open(p_user bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE conv_id bigint; created boolean;
BEGIN
 INSERT INTO community_support_conversations(owner_id) VALUES(p_user) ON CONFLICT(owner_id) DO NOTHING RETURNING id INTO conv_id;
 created:=conv_id IS NOT NULL;
 IF NOT created THEN SELECT id INTO STRICT conv_id FROM community_support_conversations WHERE owner_id=p_user; END IF;
 IF created THEN INSERT INTO community_support_messages(conversation_id,is_bot,body) VALUES(conv_id,true,'Xin chào! Bạn đang kết nối với bộ phận Hỗ Trợ PHE PHIM AI. Hãy mô tả vấn đề đang gặp phải, đội ngũ của chúng tôi sẽ phản hồi sớm nhất có thể.'); END IF;
 RETURN conv_id;
END; $$;
CREATE FUNCTION community_support_send(p_conversation bigint,p_user bigint,p_client uuid,p_body text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE conv community_support_conversations%ROWTYPE; msg community_support_messages%ROWTYPE; is_staff boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(-p_user);
 SELECT * INTO conv FROM community_support_conversations WHERE id=p_conversation FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 SELECT EXISTS(SELECT 1 FROM community_roles WHERE user_id=p_user AND role IN ('admin','moderator')) INTO is_staff;
 IF conv.owner_id<>p_user AND NOT is_staff THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF EXISTS(SELECT 1 FROM community_warning_state WHERE user_id=p_user AND banned_until>now()) THEN RETURN jsonb_build_object('error','banned'); END IF;
 IF p_body IS NULL OR char_length(trim(p_body)) NOT BETWEEN 1 AND 2000 THEN RETURN jsonb_build_object('error','invalid'); END IF;
 SELECT * INTO msg FROM community_support_messages WHERE author_id=p_user AND client_id=p_client;
 IF FOUND THEN
  IF msg.conversation_id<>p_conversation OR msg.body<>p_body THEN RETURN jsonb_build_object('error','conflict'); END IF;
  RETURN jsonb_build_object('created',false,'message',to_jsonb(msg));
 END IF;
 IF (SELECT count(*) FROM community_support_messages WHERE author_id=p_user AND created_at>now()-interval '10 seconds')>=5 THEN RETURN jsonb_build_object('error','rate'); END IF;
 INSERT INTO community_support_messages(conversation_id,author_id,body,client_id) VALUES(p_conversation,p_user,p_body,p_client) RETURNING * INTO msg;
 UPDATE community_support_conversations SET updated_at=now(),status=CASE WHEN status='resolved' THEN 'open' ELSE status END,last_user_message_at=CASE WHEN owner_id=p_user THEN now() ELSE last_user_message_at END,last_staff_message_at=CASE WHEN owner_id<>p_user AND is_staff THEN now() ELSE last_staff_message_at END WHERE id=p_conversation;
 RETURN jsonb_build_object('created',true,'message',to_jsonb(msg));
END; $$;
CREATE FUNCTION community_support_cleanup() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 WITH expired AS (SELECT id FROM community_support_conversations WHERE status='resolved' AND updated_at<=now()-interval '90 days' ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED)
 DELETE FROM community_support_conversations WHERE id IN (SELECT id FROM expired);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END; $$;
COMMIT;
