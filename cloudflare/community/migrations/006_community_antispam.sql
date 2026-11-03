BEGIN;
ALTER TABLE community_violations DROP CONSTRAINT community_violations_reason_check;
ALTER TABLE community_violations ADD CONSTRAINT community_violations_reason_check CHECK (reason IN ('url','language','advertising','solicitation','spam'));
CREATE TABLE community_moderation_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 anti_spam boolean NOT NULL DEFAULT true,
 anti_ads boolean NOT NULL DEFAULT true,
 block_solicitation boolean NOT NULL DEFAULT true,
 max_messages_10s integer NOT NULL DEFAULT 5 CHECK(max_messages_10s BETWEEN 1 AND 50),
 max_messages_60s integer NOT NULL DEFAULT 20 CHECK(max_messages_60s BETWEEN 1 AND 200),
 duplicate_window_seconds integer NOT NULL DEFAULT 60 CHECK(duplicate_window_seconds BETWEEN 10 AND 600),
 max_warnings integer NOT NULL DEFAULT 3 CHECK(max_warnings=3),
 ban_hours integer NOT NULL DEFAULT 24 CHECK(ban_hours=24),
 message_retention_days integer NOT NULL DEFAULT 30 CHECK(message_retention_days BETWEEN 1 AND 365),
 updated_by bigint REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO community_moderation_settings(singleton) VALUES(true);
CREATE TABLE community_advertising_rules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 phrase text NOT NULL UNIQUE CHECK(char_length(phrase) BETWEEN 5 AND 100),
 enabled boolean NOT NULL DEFAULT true,
 updated_by bigint REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_message_signals (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 normalized text NOT NULL CHECK(char_length(normalized)<=512),
 normalized_hash text NOT NULL CHECK(normalized_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,client_id)
);
CREATE INDEX community_message_signals_recent_idx ON community_message_signals(user_id,created_at DESC);
CREATE TABLE community_blocked_requests (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 reply_to_id bigint REFERENCES community_messages(id) ON DELETE SET NULL,
 body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
 normalized_hash text NOT NULL CHECK(normalized_hash ~ '^[a-f0-9]{64}$'),
 block_type text NOT NULL CHECK(block_type IN ('rate','duplicate')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,client_id)
);
CREATE INDEX community_blocked_requests_recent_idx ON community_blocked_requests(user_id,normalized_hash,created_at DESC);
CREATE FUNCTION community_token_similarity(a text,b text) RETURNS double precision LANGUAGE sql IMMUTABLE STRICT AS $$
 WITH aa AS (SELECT DISTINCT unnest(regexp_split_to_array(a,' +')) AS word),
 bb AS (SELECT DISTINCT unnest(regexp_split_to_array(b,' +')) AS word),
 counts AS (SELECT (SELECT count(*) FROM aa WHERE word<>'') AS na,(SELECT count(*) FROM bb WHERE word<>'') AS nb,(SELECT count(*) FROM aa JOIN bb USING(word) WHERE word<>'') AS shared)
 SELECT CASE WHEN least(na,nb)<5 THEN 0 ELSE shared::double precision/greatest(na,nb) END FROM counts;
$$;
CREATE FUNCTION community_worker_submit_v2(p_room bigint,p_user bigint,p_client uuid,p_body text,p_reason text,p_reply bigint,p_normalized text,p_body_hash text,p_normalized_hash text,p_limits jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_message community_messages%ROWTYPE; v_violation community_violations%ROWTYPE; v_state community_warning_state%ROWTYPE; v_block community_blocked_requests%ROWTYPE; v_policy community_moderation_settings%ROWTYPE; v_muted boolean; v_10 integer; v_60 integer; v_near integer; v_repeats integer; v_first timestamptz; v_type text; effective_10 integer; effective_60 integer; effective_window integer;
BEGIN
 IF p_reason IS NOT NULL AND p_reason NOT IN ('url','language','advertising','solicitation','spam') THEN RAISE EXCEPTION 'invalid reason'; END IF;
 IF char_length(p_normalized)>512 OR p_body_hash !~ '^[a-f0-9]{64}$' OR p_normalized_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid fingerprint'; END IF;
 PERFORM pg_advisory_xact_lock(-p_user);
 IF NOT EXISTS(SELECT 1 FROM community_rooms WHERE id=p_room AND enabled AND public_read) THEN RETURN jsonb_build_object('error','room'); END IF;
 SELECT * INTO v_message FROM community_messages WHERE user_id=p_user AND client_id=p_client;
 IF FOUND THEN
  IF v_message.room_id<>p_room OR v_message.body<>p_body OR v_message.reply_to_id IS DISTINCT FROM p_reply THEN RETURN jsonb_build_object('error','conflict'); END IF;
  RETURN jsonb_build_object('created',false,'message',to_jsonb(v_message));
 END IF;
 SELECT * INTO v_violation FROM community_violations WHERE user_id=p_user AND client_id=p_client;
 IF FOUND THEN
  IF v_violation.room_id<>p_room OR v_violation.body<>p_body OR v_violation.reply_to_id IS DISTINCT FROM p_reply THEN RETURN jsonb_build_object('error','conflict'); END IF;
  RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('reason',v_violation.reason,'warning_count',v_violation.warning_number,'banned_until',v_violation.banned_until,'violation_id',v_violation.id));
 END IF;
 SELECT * INTO v_block FROM community_blocked_requests WHERE user_id=p_user AND client_id=p_client;
 IF FOUND THEN
  IF v_block.room_id<>p_room OR v_block.body_hash<>p_body_hash OR v_block.reply_to_id IS DISTINCT FROM p_reply THEN RETURN jsonb_build_object('error','conflict'); END IF;
  RETURN jsonb_build_object('error',v_block.block_type);
 END IF;
 IF p_reply IS NOT NULL AND NOT EXISTS(SELECT 1 FROM community_messages WHERE id=p_reply AND room_id=p_room AND is_bot AND deleted_at IS NULL) THEN RETURN jsonb_build_object('error','reply'); END IF;
 SELECT muted_until>now() INTO v_muted FROM community_members WHERE room_id=p_room AND user_id=p_user;
 IF coalesce(v_muted,false) THEN RETURN jsonb_build_object('error','muted'); END IF;
 INSERT INTO community_warning_state(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT * INTO v_state FROM community_warning_state WHERE user_id=p_user FOR UPDATE;
 IF v_state.banned_until>now() THEN RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('banned',true,'warning_count',v_state.warning_count,'banned_until',v_state.banned_until)); END IF;
 IF v_state.banned_until IS NOT NULL AND v_state.banned_until<=now() THEN UPDATE community_warning_state SET warning_count=0,banned_until=NULL,cycle_started_at=now(),updated_at=now() WHERE user_id=p_user; END IF;
 SELECT * INTO STRICT v_policy FROM community_moderation_settings WHERE singleton=true;
 IF p_reason='advertising' AND (NOT v_policy.anti_ads OR coalesce((p_limits->>'antiAds')::boolean,false)=false) THEN p_reason:=NULL; END IF;
 IF p_reason='solicitation' AND (NOT v_policy.block_solicitation OR coalesce((p_limits->>'antiSolicitation')::boolean,false)=false) THEN p_reason:=NULL; END IF;
 effective_10:=least(v_policy.max_messages_10s,greatest(1,least(50,coalesce((p_limits->>'max10')::integer,5))));
 effective_60:=least(v_policy.max_messages_60s,greatest(1,least(200,coalesce((p_limits->>'max60')::integer,20))));
 effective_window:=greatest(v_policy.duplicate_window_seconds,greatest(10,least(600,coalesce((p_limits->>'duplicateSeconds')::integer,60))));
 IF v_policy.anti_spam AND coalesce((p_limits->>'antiSpam')::boolean,false) THEN
  SELECT count(*) FILTER(WHERE created_at>now()-interval '10 seconds'),count(*) INTO v_10,v_60 FROM community_messages WHERE user_id=p_user AND NOT is_bot AND created_at>now()-interval '60 seconds';
  IF v_10>=effective_10 OR v_60>=effective_60 THEN
   INSERT INTO community_blocked_requests(user_id,room_id,client_id,reply_to_id,body_hash,normalized_hash,block_type) VALUES(p_user,p_room,p_client,p_reply,p_body_hash,p_normalized_hash,'rate');
   RETURN jsonb_build_object('error','rate');
  END IF;
  IF p_normalized<>'' AND EXISTS(SELECT 1 FROM community_message_signals WHERE user_id=p_user AND normalized_hash=p_normalized_hash AND created_at>now()-make_interval(secs=>effective_window)) THEN
   SELECT count(*),min(created_at) INTO v_repeats,v_first FROM community_blocked_requests WHERE user_id=p_user AND normalized_hash=p_normalized_hash AND block_type='duplicate' AND created_at>now()-make_interval(secs=>effective_window);
   IF v_repeats>=3 AND v_first<=now()-interval '5 seconds' THEN p_reason:='spam';
   ELSE
    INSERT INTO community_blocked_requests(user_id,room_id,client_id,reply_to_id,body_hash,normalized_hash,block_type) VALUES(p_user,p_room,p_client,p_reply,p_body_hash,p_normalized_hash,'duplicate');
    RETURN jsonb_build_object('error','duplicate');
   END IF;
  END IF;
  IF p_reason IS NULL AND char_length(p_normalized)>=24 THEN
   SELECT count(*) INTO v_near FROM community_message_signals WHERE user_id=p_user AND created_at>now()-interval '60 seconds' AND normalized_hash<>p_normalized_hash AND community_token_similarity(normalized,p_normalized)>=0.82;
   IF v_near>=2 THEN p_reason:='spam'; END IF;
  END IF;
 END IF;
 IF p_reason='spam' AND (NOT v_policy.anti_spam OR coalesce((p_limits->>'antiSpam')::boolean,false)=false) THEN p_reason:=NULL; END IF;
 IF p_reason IS NOT NULL THEN
  UPDATE community_warning_state SET warning_count=warning_count+1,banned_until=CASE WHEN warning_count+1>=v_policy.max_warnings THEN now()+make_interval(hours=>v_policy.ban_hours) ELSE NULL END,updated_at=now() WHERE user_id=p_user RETURNING * INTO v_state;
  INSERT INTO community_violations(user_id,room_id,client_id,reply_to_id,body,reason,warning_number,banned_until) VALUES(p_user,p_room,p_client,p_reply,p_body,p_reason,v_state.warning_count,v_state.banned_until) RETURNING * INTO v_violation;
  RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('reason',p_reason,'warning_count',v_state.warning_count,'banned_until',v_state.banned_until,'violation_id',v_violation.id));
 END IF;
 INSERT INTO community_messages(room_id,user_id,body,client_id,reply_to_id) VALUES(p_room,p_user,p_body,p_client,p_reply) RETURNING * INTO v_message;
 INSERT INTO community_members(room_id,user_id) VALUES(p_room,p_user) ON CONFLICT DO NOTHING;
 IF v_policy.anti_spam AND coalesce((p_limits->>'antiSpam')::boolean,false) AND p_normalized<>'' THEN INSERT INTO community_message_signals(user_id,room_id,client_id,normalized,normalized_hash) VALUES(p_user,p_room,p_client,p_normalized,p_normalized_hash); END IF;
 RETURN jsonb_build_object('created',true,'message',to_jsonb(v_message));
END; $$;
CREATE FUNCTION community_worker_cleanup() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE days integer; count_cleaned integer;
BEGIN
 SELECT message_retention_days INTO STRICT days FROM community_moderation_settings WHERE singleton=true;
 WITH expired AS (SELECT id FROM community_messages m WHERE m.created_at<now()-make_interval(days=>days) AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM community_pins p WHERE p.message_id=m.id) ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED)
 UPDATE community_messages SET body='[Đã hết hạn]',deleted_at=now() WHERE id IN (SELECT id FROM expired);
 GET DIAGNOSTICS count_cleaned=ROW_COUNT;
 DELETE FROM community_message_signals WHERE created_at<now()-interval '15 minutes';
 DELETE FROM community_blocked_requests WHERE created_at<now()-interval '24 hours';
 RETURN count_cleaned;
END; $$;
COMMIT;
