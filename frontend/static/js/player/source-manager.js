import {attachHls} from './hls-adapter.js';
import {attachDash} from './dash-adapter.js';

export function sourceManager(video, iframe, {onMessage, onCredit, onAttempt, onSourceChange}) {
  const playButton = document.querySelector('#player-play');
  let sources = [], adapter = null, index = 0, generation = 0, timeout = null;
  let failures = new Set(), restore = 0, userStarted = false;

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
    if (error?.code === 4) return 'Nguồn không tồn tại hoặc định dạng/codec không được hỗ trợ. Kiểm tra URL, MIME và codec.';
    return 'Không tải được nguồn video. Kiểm tra kết nối hoặc thử lại.';
  }

  function watchdog(current) {
    clearTimer();
    timeout = setTimeout(() => failure(current, 'Video tải quá lâu. Kiểm tra kết nối hoặc thử lại.'), 20000);
  }

  function failure(current, message) {
    if (current !== generation) return;
    clearTimer();
    failures.add(index);
    const next = sources.findIndex((_, i) => !failures.has(i));
    if (next >= 0) {
      restore = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      onMessage('Nguồn gặp lỗi, đang thử nguồn dự phòng…');
      attach(next, {resume: true});
      return;
    }
    ++generation;
    stopActive();
    onMessage(message || errorText(video.error), true, sources[index]);
  }

  function playFromGesture() {
    if (video.hidden) return;
    const current = generation;
    userStarted = true;
    onMessage('Đang tải video…');
    watchdog(current);
    try {
      const promise = video.play();
      if (promise?.catch) {
        promise.catch(error => {
          if (current !== generation) return;
          clearTimer();
          playButton.hidden = false;
          if (error.name === 'NotSupportedError') {
            failure(current, 'Định dạng hoặc codec nguồn không được trình duyệt hỗ trợ.');
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
      onFatal: message => failure(current, message || 'Không tải được luồng phát. Kiểm tra kết nối hoặc thử lại.')
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
      stopActive();
    }
  };
}
