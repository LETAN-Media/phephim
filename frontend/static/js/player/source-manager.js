import {attachHls} from './hls-adapter.js';
import {attachDash} from './dash-adapter.js';

export function sourceManager(video, iframe, {onMessage, onCredit, onAttempt, onSourceChange, onRefreshSources}) {
  const playButton = document.querySelector('#player-play');
  let sources = [], adapter = null, index = 0, generation = 0, timeout = null;
  let failures = new Set(), restore = 0, userStarted = false, hasRefreshed = false;

  function clearTimer() {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  function stopActive() {
    clearTimer();
    if (adapter) {
      adapter.destroy();
      adapter = null;
    }
    video.onloadedmetadata = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    playButton.hidden = true;

    iframe.hidden = true;
    iframe.src = 'about:blank';
    iframe.removeAttribute('src');
  }

  function subtitles(source) {
    video.querySelectorAll('track').forEach(track => track.remove());
    if ((source.subtitles || []).some(item => new URL(item.url, location.href).origin !== location.origin)) {
      video.crossOrigin = 'anonymous';
    } else {
      video.removeAttribute('crossorigin');
    }
    (source.subtitles || []).forEach(subtitle => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = subtitle.language;
      track.label = subtitle.label;
      track.src = subtitle.url;
      track.default = subtitle.is_default;
      video.append(track);
    });
  }

  function errorText(error) {
    if (error?.code === 2) return 'Lỗi mạng khi tải video. Kiểm tra kết nối hoặc thử lại.';
    if (error?.code === 3) return 'Không giải mã được video. Nguồn có thể dùng codec không tương thích.';
    if (error?.code === 4) return 'Nguồn không tồn tại hoặc định dạng video không được hỗ trợ.';
    return 'Không thể phát video từ nguồn này. Vui lòng thử lại.';
  }

  function ytErrorText(code) {
    if (code === 101 || code === 150) return 'Video không cho phép nhúng trên trang ngoài.';
    if (code === 100) return 'Video không tồn tại hoặc đã bị xóa trên nền tảng gốc.';
    if (code === 153) return 'Lỗi cấu hình trình phát từ nền tảng video (Referrer Policy).';
    return 'Nguồn phát gặp lỗi khi khởi tạo.';
  }

  function watchdog(current) {
    clearTimer();
    timeout = setTimeout(() => failure(current, 'Video tải quá lâu. Kiểm tra kết nối hoặc thử lại.'), 20000);
  }

  async function failure(current, message, errorCode = null) {
    if (current !== generation) return;
    clearTimer();
    failures.add(index);
    const next = sources.findIndex((_, i) => !failures.has(i));
    if (next >= 0) {
      restore = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      onMessage('Đang chuyển sang nguồn dự phòng…');
      attach(next, {resume: true});
      return;
    }
    // If sources failed (e.g. signed URL expired), attempt dynamic refresh once and preserve playback position
    if (typeof onRefreshSources === 'function' && !hasRefreshed) {
      hasRefreshed = true;
      try {
        const savedPos = Number.isFinite(video.currentTime) ? video.currentTime : restore;
        onMessage('Đang làm mới liên kết phát…');
        const fresh = await onRefreshSources();
        if (fresh && fresh.length > 0) {
          sources = fresh;
          failures.clear();
          restore = savedPos;
          attach(0, {resume: true});
          return;
        }
      } catch (err) {
        // Fall back to normal fatal handling
      }
    }
    ++generation;
    stopActive();
    const finalMsg = errorCode ? ytErrorText(errorCode) : (message || errorText(video.error));
    onMessage(finalMsg, true, sources[index]);
  }

  function onWindowMessage(event) {
    if (!event.origin.includes('youtube.com') && !event.origin.includes('youtube-nocookie.com')) return;
    let data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data) return;

    if (data.event === 'onError' || (data.info && typeof data.info.errorCode === 'number')) {
      const code = data.info?.errorCode || data.info;
      failure(generation, ytErrorText(code), code);
    }
  }

  window.addEventListener('message', onWindowMessage);

  function playFromGesture() {
    if (video.hidden) return;
    const current = generation;
    userStarted = true;
    onMessage('');
    watchdog(current);
    try {
      const promise = video.play();
      if (promise?.catch) {
        promise.catch(error => {
          if (current !== generation) return;
          clearTimer();
          playButton.hidden = false;
          if (error.name === 'NotSupportedError') {
            failure(current, 'Định dạng video không được trình duyệt hỗ trợ.');
          } else {
            onMessage('Không thể bắt đầu phát. Nhấn Phát để thử lại.');
          }
        });
      }
    } catch {
      clearTimer();
      playButton.hidden = false;
      onMessage('Không thể bắt đầu phát. Nhấn Phát để thử lại.');
    }
  }

  async function attach(chosen, {resume = false} = {}) {
    const source = sources[chosen];
    if (!source) return;
    const current = ++generation;
    stopActive();
    index = chosen;
    onCredit(source.attribution || '');
    if (onSourceChange) onSourceChange(chosen, source);
    onAttempt(source, chosen);

    if (source.media_type === 'iframe') {
      iframe.src = source.url;
      iframe.hidden = false;
      onMessage('');
      return;
    }

    video.hidden = false;
    subtitles(source);
    onMessage('Nhấn Phát để bắt đầu xem.');

    const options = {
      onLevels: () => {},
      onFatal: msg => failure(current, msg || 'Không tải được luồng phát. Kiểm tra kết nối hoặc thử lại.')
    };

    try {
      video.onloadedmetadata = () => {
        if (current !== generation) return;
        if (restore > 0 && Number.isFinite(video.duration) && restore < video.duration - 3) {
          video.currentTime = restore;
        }
        if (resume && userStarted) playFromGesture();
      };

      if (source.media_type === 'mp4') {
        video.src = source.url;
        video.load();
      } else if (source.media_type === 'hls') {
        const result = await attachHls(video, source.url, options);
        if (current !== generation) {
          result.destroy();
          return;
        }
        adapter = result;
      } else if (source.media_type === 'dash') {
        const result = await attachDash(video, source.url, options);
        if (current !== generation) {
          result.destroy();
          return;
        }
        adapter = result;
      } else {
        throw new Error('unsupported');
      }

      if (current !== generation) return;
      playButton.hidden = false;
    } catch {
      if (current === generation) failure(current, 'Không thể khởi tạo định dạng nguồn trên trình duyệt này.');
    }
  }

  video.addEventListener('error', () => {
    if (!video.hidden && video.error && video.error.code !== 1) failure(generation, errorText(video.error));
  });
  video.addEventListener('playing', () => {
    clearTimer();
    userStarted = true;
    playButton.hidden = true;
    onMessage('');
  });
  video.addEventListener('pause', () => {
    if (!video.hidden && !video.ended) {
      clearTimer();
      playButton.hidden = false;
    }
  });
  video.addEventListener('ended', () => {
    clearTimer();
    playButton.hidden = false;
  });
  video.addEventListener('waiting', () => {
    if (!video.paused) {
      onMessage('Đang tải video…');
      watchdog(generation);
    }
  });
  video.addEventListener('stalled', () => {
    if (!video.paused) {
      onMessage('Kết nối đang chậm, tiếp tục tải video…');
      watchdog(generation);
    }
  });
  video.addEventListener('canplay', () => {
    clearTimer();
    onMessage('');
  });
  playButton.addEventListener('click', playFromGesture);

  return {
    set(nextSources, position = 0) {
      sources = nextSources || [];
      restore = position;
      userStarted = false;
      hasRefreshed = false;
      failures.clear();
      index = 0;
      if (sources.length) {
        attach(0);
      } else {
        stopActive();
      }
    },
    switchSource(targetIndex) {
      if (targetIndex < 0 || targetIndex >= sources.length || targetIndex === index) return;
      restore = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      failures.delete(targetIndex);
      attach(targetIndex, {resume: userStarted});
    },
    getCurrentSource() {
      return sources[index] || null;
    },
    getIndex() {
      return index;
    },
    getSources() {
      return sources;
    },
    retry() {
      failures.clear();
      attach(index);
    },
    destroy() {
      generation++;
      window.removeEventListener('message', onWindowMessage);
      stopActive();
    }
  };
}
