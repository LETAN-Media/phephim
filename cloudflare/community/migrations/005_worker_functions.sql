BEGIN;
CREATE FUNCTION community_worker_submit(p_room bigint,p_user bigint,p_client uuid,p_body text,p_reason text,p_reply bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_message community_messages%ROWTYPE; v_violation community_violations%ROWTYPE; v_state community_warning_state%ROWTYPE; v_muted boolean; v_count integer;
BEGIN
 IF p_reason IS NOT NULL AND p_reason NOT IN ('url','language') THEN RAISE EXCEPTION 'invalid reason'; END IF;
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
   RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('reason',v_violation.reason,'warning_count',v_violation.warning_number,'banned_until',v_violation.banned_until));
 END IF;
 IF p_reply IS NOT NULL AND NOT EXISTS(SELECT 1 FROM community_messages WHERE id=p_reply AND room_id=p_room AND is_bot AND deleted_at IS NULL) THEN RETURN jsonb_build_object('error','reply'); END IF;
 SELECT muted_until>now() INTO v_muted FROM community_members WHERE room_id=p_room AND user_id=p_user;
 IF coalesce(v_muted,false) THEN RETURN jsonb_build_object('error','muted'); END IF;
 INSERT INTO community_warning_state(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT * INTO v_state FROM community_warning_state WHERE user_id=p_user FOR UPDATE;
 IF v_state.banned_until>now() THEN RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('banned',true,'warning_count',v_state.warning_count,'banned_until',v_state.banned_until)); END IF;
 IF v_state.banned_until IS NOT NULL AND v_state.banned_until<=now() THEN
   UPDATE community_warning_state SET warning_count=0,banned_until=NULL,cycle_started_at=now(),updated_at=now() WHERE user_id=p_user;
 END IF;
 IF p_reason IS NOT NULL THEN
   UPDATE community_warning_state SET warning_count=warning_count+1,banned_until=CASE WHEN warning_count+1>=3 THEN now()+interval '24 hours' ELSE NULL END,updated_at=now() WHERE user_id=p_user RETURNING * INTO v_state;
   INSERT INTO community_violations(user_id,room_id,client_id,reply_to_id,body,reason,warning_number,banned_until) VALUES(p_user,p_room,p_client,p_reply,p_body,p_reason,v_state.warning_count,v_state.banned_until);
   RETURN jsonb_build_object('created',false,'moderation',jsonb_build_object('reason',p_reason,'warning_count',v_state.warning_count,'banned_until',v_state.banned_until));
 END IF;
 SELECT count(*) INTO v_count FROM community_messages WHERE user_id=p_user AND created_at>now()-interval '10 seconds';
 IF v_count>=5 THEN RETURN jsonb_build_object('error','rate'); END IF;
 INSERT INTO community_messages(room_id,user_id,body,client_id,reply_to_id) VALUES(p_room,p_user,p_body,p_client,p_reply) RETURNING * INTO v_message;
 INSERT INTO community_members(room_id,user_id) VALUES(p_room,p_user) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('created',true,'message',to_jsonb(v_message));
END; $$;
CREATE FUNCTION community_worker_welcome(p_room bigint,p_user bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_name text; v_time timestamptz; v_message community_messages%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(-p_user);
 SELECT u.username INTO v_name FROM users u JOIN community_rooms r ON r.id=p_room AND r.enabled AND r.public_read WHERE u.id=p_user AND NOT EXISTS(SELECT 1 FROM community_warning_state s WHERE s.user_id=u.id AND s.banned_until>now());
 IF v_name IS NULL THEN RETURN NULL; END IF;
 INSERT INTO community_welcome_state(user_id,room_id,last_welcomed_at) VALUES(p_user,p_room,now())
 ON CONFLICT(user_id,room_id) DO UPDATE SET last_welcomed_at=now() WHERE community_welcome_state.last_welcomed_at<=now()-interval '24 hours' RETURNING last_welcomed_at INTO v_time;
 IF v_time IS NULL THEN RETURN NULL; END IF;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(p_room,true,'Chào mừng @'||v_name||E' đến với Cộng đồng PHE PHIM AI!\n\nNơi những người yêu điện ảnh cùng hội tụ, chia sẻ cảm nhận và khám phá những bộ phim đáng xem.\n\nCứ thoải mái trò chuyện và hỏi phim nhé! Chúc bạn có những phút giây thư giãn tuyệt vời.') RETURNING * INTO v_message;
 RETURN to_jsonb(v_message);
END; $$;
CREATE FUNCTION community_worker_bot_reply(p_room bigint,p_source bigint,p_body text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_message community_messages%ROWTYPE; v_key text;
BEGIN
 v_key:='ai-reply:'||p_source;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 IF EXISTS(SELECT 1 FROM bot_announcements WHERE dedupe_key=v_key) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM community_messages WHERE id=p_source AND room_id=p_room AND NOT is_bot AND deleted_at IS NULL) THEN RETURN NULL; END IF;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(p_room,true,p_body) RETURNING * INTO v_message;
 INSERT INTO bot_announcements(room_id,message_id,dedupe_key) VALUES(p_room,v_message.id,v_key);
 RETURN to_jsonb(v_message);
END; $$;
CREATE FUNCTION community_worker_telegram_publish(p_draft bigint,p_channel text,p_actor bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_draft telegram_drafts%ROWTYPE; v_message community_messages%ROWTYPE; v_key text;
BEGIN
 SELECT * INTO v_draft FROM telegram_drafts WHERE id=p_draft FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF v_draft.status='published' THEN RETURN jsonb_build_object('already',true,'message_id',v_draft.announcement_message_id); END IF;
 v_key:='telegram-draft:'||p_draft;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(v_draft.room_id,true,v_draft.body) RETURNING * INTO v_message;
 INSERT INTO bot_announcements(room_id,message_id,dedupe_key) VALUES(v_draft.room_id,v_message.id,v_key);
 INSERT INTO community_pins(room_id,message_id) VALUES(v_draft.room_id,v_message.id);
 UPDATE telegram_drafts SET status='published',announcement_message_id=v_message.id WHERE id=p_draft;
 INSERT INTO telegram_admin_actions(actor_telegram_id,action,target_id) VALUES(p_actor,'publish',p_draft);
 IF p_channel IS NOT NULL AND p_channel<>'' THEN INSERT INTO telegram_deliveries(message_id,destination) VALUES(v_message.id,p_channel) ON CONFLICT DO NOTHING; END IF;
 INSERT INTO telegram_deliveries(message_id,destination) SELECT v_message.id,telegram_user_id::text FROM telegram_subscribers WHERE active ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('message_id',v_message.id,'room_id',v_draft.room_id);
END; $$;
CREATE FUNCTION community_worker_claim_delivery()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_dest text; v_body text;
BEGIN
 SELECT d.id,d.destination,m.body INTO v_id,v_dest,v_body FROM telegram_deliveries d JOIN community_messages m ON m.id=d.message_id
 WHERE d.state='pending' ORDER BY d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 UPDATE telegram_deliveries SET state='sending',updated_at=now() WHERE id=v_id;
 RETURN jsonb_build_object('id',v_id,'destination',v_dest,'body',v_body);
END; $$;
CREATE FUNCTION community_worker_scheduled_publish(p_channel text,p_sync boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_job bot_schedules%ROWTYPE; v_message community_messages%ROWTYPE; v_key text;
BEGIN
 SELECT * INTO v_job FROM bot_schedules WHERE enabled AND next_at<=now() ORDER BY next_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_key:='schedule:'||v_job.id||':'||extract(epoch from v_job.next_at)::text;
 IF EXISTS(SELECT 1 FROM bot_announcements WHERE dedupe_key=v_key) THEN RAISE EXCEPTION 'schedule already exists'; END IF;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(v_job.room_id,true,v_job.body) RETURNING * INTO v_message;
 INSERT INTO bot_announcements(room_id,message_id,dedupe_key,schedule_id) VALUES(v_job.room_id,v_message.id,v_key,v_job.id);
 IF v_job.pin THEN INSERT INTO community_pins(room_id,message_id) VALUES(v_job.room_id,v_message.id); END IF;
 IF p_sync THEN
  IF p_channel IS NOT NULL AND p_channel<>'' THEN INSERT INTO telegram_deliveries(message_id,destination) VALUES(v_message.id,p_channel) ON CONFLICT DO NOTHING; END IF;
  INSERT INTO telegram_deliveries(message_id,destination) SELECT v_message.id,telegram_user_id::text FROM telegram_subscribers WHERE active ON CONFLICT DO NOTHING;
 END IF;
 UPDATE bot_schedules SET enabled=(interval_seconds IS NOT NULL),next_at=CASE WHEN interval_seconds IS NULL THEN next_at ELSE next_at+interval_seconds*interval '1 second' END WHERE id=v_job.id;
 RETURN jsonb_build_object('room_id',v_job.room_id,'message',to_jsonb(v_message),'pinned',v_job.pin);
END; $$;
CREATE FUNCTION community_worker_claim_event(p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v community_notification_events%ROWTYPE; v_used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('community:event:budget',0));
 UPDATE community_notification_events SET state='failed' WHERE state='processing' AND attempts>=3 AND lease_until<=now();
 SELECT coalesce(sum(attempts),0) INTO v_used FROM community_notification_events WHERE created_at>now()-interval '24 hours';
 IF v_used>=20 THEN RETURN NULL; END IF;
 SELECT * INTO v FROM community_notification_events WHERE attempts<3 AND next_attempt_at<=now() AND (state='pending' OR (state='processing' AND lease_until<=now())) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE community_notification_events SET state='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=p_lease WHERE id=v.id RETURNING * INTO v;
 RETURN to_jsonb(v);
END; $$;
CREATE FUNCTION community_worker_finish_event(p_id bigint,p_lease uuid,p_body text,p_channel text,p_sync boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v community_notification_events%ROWTYPE; v_msg community_messages%ROWTYPE; v_room bigint;
BEGIN
 SELECT * INTO v FROM community_notification_events WHERE id=p_id AND state='processing' AND lease_token=p_lease FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v.event_type='episode.published' AND NOT EXISTS(SELECT 1 FROM movie_episodes WHERE movie_slug=v.movie_slug AND episode_key=v.episode_key) THEN RAISE EXCEPTION 'event stale'; END IF;
 IF v.event_type='movie.schedule_updated' AND NOT EXISTS(SELECT 1 FROM community_movie_releases WHERE movie_slug=v.movie_slug AND release_at=v.release_at) THEN RAISE EXCEPTION 'event stale'; END IF;
 SELECT id INTO v_room FROM community_rooms WHERE slug='cong-dong-chung' AND enabled;
 IF v_room IS NULL THEN RAISE EXCEPTION 'room missing'; END IF;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(v_room,true,p_body) RETURNING * INTO v_msg;
 INSERT INTO bot_announcements(room_id,message_id,dedupe_key) VALUES(v_room,v_msg.id,'event:'||v.id);
 INSERT INTO community_pins(room_id,message_id) VALUES(v_room,v_msg.id);
 UPDATE community_notification_events SET state='done',message_id=v_msg.id,lease_until=NULL,lease_token=NULL WHERE id=v.id;
 IF p_sync THEN
   IF p_channel IS NOT NULL AND p_channel<>'' THEN INSERT INTO telegram_deliveries(message_id,destination) VALUES(v_msg.id,p_channel) ON CONFLICT DO NOTHING; END IF;
   INSERT INTO telegram_deliveries(message_id,destination) SELECT v_msg.id,telegram_user_id::text FROM telegram_subscribers WHERE active ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('room_id',v_room,'message_id',v_msg.id);
END; $$;
CREATE FUNCTION community_worker_unban(p_actor bigint,p_user bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(-p_user);
 UPDATE community_warning_state SET warning_count=0,banned_until=NULL,cycle_started_at=now(),updated_at=now() WHERE user_id=p_user;
 INSERT INTO community_moderation_actions(actor_id,action,target_user_id) VALUES(p_actor,'unban',p_user);
 RETURN true;
END; $$;
CREATE FUNCTION community_worker_void_warning(p_actor bigint,p_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_user bigint; v_changed bigint; v_count bigint;
BEGIN
 SELECT user_id INTO v_user FROM community_violations WHERE id=p_id;
 IF v_user IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(-v_user);
 UPDATE community_violations SET voided_at=now(),reviewed_by=p_actor,appeal_status='voided' WHERE id=p_id AND voided_at IS NULL RETURNING user_id INTO v_changed;
 IF v_changed IS NOT NULL THEN
  SELECT count(*) INTO v_count FROM community_violations v JOIN community_warning_state s ON s.user_id=v.user_id WHERE v.user_id=v_user AND v.voided_at IS NULL AND v.created_at>=s.cycle_started_at;
  UPDATE community_warning_state SET warning_count=least(3,v_count),banned_until=CASE WHEN v_count>=3 THEN banned_until ELSE NULL END,updated_at=now() WHERE user_id=v_user;
  INSERT INTO community_moderation_actions(actor_id,action,target_user_id,details) VALUES(p_actor,'void_warning',v_user,jsonb_build_object('violation_id',p_id));
 END IF;
 RETURN true;
END; $$;
CREATE FUNCTION community_worker_set_release(p_actor bigint,p_slug text,p_release timestamptz,p_note text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE previous timestamptz; key text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('release:'||p_slug,0));
 SELECT release_at INTO previous FROM community_movie_releases WHERE movie_slug=p_slug;
 INSERT INTO community_movie_releases(movie_slug,release_at,verification_note,verified_by) VALUES(p_slug,p_release,p_note,p_actor)
 ON CONFLICT(movie_slug) DO UPDATE SET release_at=excluded.release_at,verification_note=excluded.verification_note,verified_by=excluded.verified_by,updated_at=now();
 IF previous IS DISTINCT FROM p_release THEN
  key:='release:'||p_slug||':'||extract(epoch from p_release)::text;
  INSERT INTO community_notification_events(event_type,dedupe_key,movie_slug,release_at) VALUES('movie.schedule_updated',key,p_slug,p_release) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO community_moderation_actions(actor_id,action,details) VALUES(p_actor,'release_schedule',jsonb_build_object('slug',p_slug,'release_at',p_release));
 RETURN true;
END; $$;
CREATE FUNCTION community_worker_admin_announce(p_actor bigint,p_room bigint,p_request uuid,p_body text,p_pin boolean,p_channel text,p_sync boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_message community_messages%ROWTYPE; v_key text;
BEGIN
 v_key:='admin:'||p_request;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 SELECT m.* INTO v_message FROM bot_announcements a JOIN community_messages m ON m.id=a.message_id WHERE a.dedupe_key=v_key;
 IF FOUND THEN
  IF v_message.room_id<>p_room OR v_message.body<>p_body THEN RETURN jsonb_build_object('error','conflict'); END IF;
  RETURN jsonb_build_object('id',v_message.id,'created',false);
 END IF;
 INSERT INTO community_messages(room_id,is_bot,body) VALUES(p_room,true,p_body) RETURNING * INTO v_message;
 INSERT INTO bot_announcements(room_id,message_id,dedupe_key) VALUES(p_room,v_message.id,v_key);
 IF p_pin THEN INSERT INTO community_pins(room_id,message_id,pinned_by) VALUES(p_room,v_message.id,p_actor); END IF;
 INSERT INTO community_moderation_actions(actor_id,action,room_id,message_id) VALUES(p_actor,'announcement',p_room,v_message.id);
 IF p_sync THEN
  IF p_channel IS NOT NULL AND p_channel<>'' THEN INSERT INTO telegram_deliveries(message_id,destination) VALUES(v_message.id,p_channel) ON CONFLICT DO NOTHING; END IF;
  INSERT INTO telegram_deliveries(message_id,destination) SELECT v_message.id,telegram_user_id::text FROM telegram_subscribers WHERE active ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('id',v_message.id,'created',true);
END; $$;
CREATE FUNCTION community_worker_sync_catalog(p_slugs jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_slug text; initialized boolean; inserted text; total integer:=0;
BEGIN
 IF jsonb_typeof(p_slugs)<>'array' OR jsonb_array_length(p_slugs)=0 OR jsonb_array_length(p_slugs)>10000 THEN RAISE EXCEPTION 'invalid catalog'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('community:catalog:sync',0));
 SELECT EXISTS(SELECT 1 FROM community_catalog_state WHERE singleton=true) INTO initialized;
 FOR v_slug IN SELECT jsonb_array_elements_text(p_slugs) LOOP
  IF v_slug !~ '^[a-z0-9-]{1,128}$' THEN RAISE EXCEPTION 'invalid slug'; END IF;
  inserted:=NULL;
  INSERT INTO community_catalog_snapshot(movie_slug) VALUES(v_slug) ON CONFLICT DO NOTHING RETURNING movie_slug INTO inserted;
  IF inserted IS NOT NULL AND initialized THEN
   INSERT INTO community_notification_events(event_type,dedupe_key,movie_slug) VALUES('movie.published','movie:'||v_slug,v_slug) ON CONFLICT DO NOTHING;
   total:=total+1;
  END IF;
 END LOOP;
 IF NOT initialized THEN INSERT INTO community_catalog_state(singleton) VALUES(true) ON CONFLICT DO NOTHING; END IF;
 RETURN total;
END; $$;
COMMIT;
