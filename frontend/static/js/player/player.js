import {movieApi} from '../movies/movie-api.js';
import {sourceManager} from './source-manager.js';
import {episodeSelector} from './episode-selector.js';
import {progressTracker} from './watch-progress.js';

const root = document.querySelector('#watch-page');
const slug = root.dataset.slug;
const video = document.querySelector('#movie-video');
const iframe = document.querySelector('#movie-embed');
const empty = document.querySelector('#player-empty');
const emptyMessage = document.querySelector('#player-message');
const status = document.querySelector('#player-status');
const notice = document.querySelector('#watch-notice');
const credit = document.querySelector('#source-credit');
const retry = document.querySelector('#retry-source');
const demoLink = document.querySelector('#demo-link');
const externalLink = document.querySelector('#external-link');
const externalLinkText = document.querySelector('#external-link-text');
const demoBanner = document.querySelector('#demo-banner');

const movieUrl = `/api/movies/${encodeURIComponent(slug)}`;
let tracker = null, selector = null, episode = null, requestVersion = 0;

const note = (message, fatal = false, failedSource = null) => {
  status.textContent = message;
  status.hidden = !message || fatal;
  if (fatal) {
    empty.hidden = false;
    emptyMessage.textContent = message;
    retry.hidden = false;
    if (failedSource && failedSource.external_url) {
      externalLink.href = failedSource.external_url;
      const plat = failedSource.platform === 'youtube' ? 'YouTube' : (failedSource.platform === 'facebook' ? 'Facebook' : 'nền tảng gốc');
      externalLinkText.textContent = `Mở video trên ${plat}`;
      externalLink.hidden = false;
    } else {
      externalLink.hidden = true;
    }
  } else {
    externalLink.hidden = true;
    notice.textContent = message || '';
  }
};

const manager = sourceManager(video, iframe, {
  onMessage: note,
  onCredit: text => {
    credit.textContent = slug === 'big-buck-bunny-demo' ? text : '';
  },
  onAttempt: () => {
    empty.hidden = true;
    retry.hidden = true;
    demoLink.hidden = true;
    externalLink.hidden = true;
  }
});

retry.addEventListener('click', () => manager.retry());

async function json(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.' : 'Không thể tải dữ liệu phim. Vui lòng thử lại.');
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Kết nối quá lâu. Vui lòng tải lại trang.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function drawRelated(items) {
  const grid = document.querySelector('#related-movies');
  items.filter(item => item.slug !== slug).slice(0, 6).forEach(movie => {
    const a = document.createElement('a');
    a.href = `/phim/${encodeURIComponent(movie.slug)}/`;
    const img = document.createElement('img');
    img.src = movie.poster;
    img.alt = `Poster ${movie.title}`;
    img.loading = 'lazy';
    const title = document.createElement('h3');
    title.textContent = movie.title;
    const info = document.createElement('p');
    info.textContent = `${movie.year} · ★ ${movie.rating}`;
    a.append(img, title, info);
    grid.append(a);
  });
}

async function selectEpisode(value, {updateUrl = true} = {}) {
  const version = ++requestVersion;
  if (tracker) {
    tracker.save();
    tracker.destroy();
    tracker = null;
  }
  manager.destroy();
  episode = value;
  selector?.set(value);

  if (updateUrl) {
    const url = new URL(location.href);
    if (value) url.searchParams.set('episode', value);
    else url.searchParams.delete('episode');
    history.replaceState(null, '', url);
  }

  empty.hidden = false;
  retry.hidden = true;
  demoLink.hidden = true;
  externalLink.hidden = true;
  emptyMessage.textContent = 'Đang tải thông tin nguồn phát…';
  status.hidden = true;
  notice.textContent = '';
  credit.textContent = '';

  try {
    const route = value ? `${movieUrl}/episodes/${encodeURIComponent(value)}/playback` : `${movieUrl}/playback`;
    const playback = await json(route);
    if (version !== requestVersion) return;

    if (!playback.sources.length) {
      emptyMessage.textContent = 'Nguồn phim đang được cập nhật';
      demoLink.hidden = slug === 'big-buck-bunny-demo';
      return;
    }

    if (slug !== 'big-buck-bunny-demo') {
      demoBanner.hidden = true;
    }

    tracker = progressTracker(video, slug, value, text => {
      notice.textContent = text;
    });

    let position = 0;
    try {
      position = (await tracker.read()).position_seconds || 0;
    } catch {
      notice.textContent = 'Không thể tải tiến độ xem trước đó.';
    }

    if (version !== requestVersion) return;
    empty.hidden = true;
    notice.textContent = position > 0 ? 'Sẽ tiếp tục từ vị trí đã lưu.' : '';
    manager.set(playback.sources, position);
  } catch (error) {
    if (version === requestVersion) {
      emptyMessage.textContent = error.message;
    }
  }
}

async function init() {
  try {
    const [movie, episodeData, related] = await Promise.all([
      json(movieUrl),
      json(`${movieUrl}/episodes`),
      movieApi.list()
    ]);

    document.title = `${movie.title} – PHE PHIM AI`;
    document.querySelector('#movie-title').textContent = movie.title;
    document.querySelector('#movie-meta').textContent = [
      movie.year,
      movie.country,
      movie.genre,
      movie.rating != null ? `★ ${movie.rating}` : null,
      movie.status
    ].filter(Boolean).join(' · ');

    const isDemoFilm = slug === 'big-buck-bunny-demo';
    const back = isDemoFilm ? '/' : `/phim/${encodeURIComponent(slug)}/`;
    document.querySelector('#detail-back').href = back;
    document.querySelector('#empty-back').href = back;

    if (isDemoFilm) {
      demoBanner.hidden = false;
      document.querySelector('#detail-back').lastChild.textContent = ' Trang chủ';
      document.querySelector('#empty-back').lastChild.textContent = ' Về trang chủ';
    } else {
      demoBanner.hidden = true;
    }

    drawRelated(related);

    const list = episodeData.episodes;
    const requested = new URLSearchParams(location.search).get('episode');
    const validRequest = !requested || list.some(item => item.episode_key === requested);
    const initial = list.length ? (validRequest ? (requested || list[0].episode_key) : null) : null;

    selector = episodeSelector(list, initial, selectEpisode, {series: /phim bộ|mùa/i.test(movie.status || '')});
    if (!validRequest) {
      emptyMessage.textContent = 'Không tìm thấy tập phim.';
      return;
    }
    await selectEpisode(initial, {updateUrl: !!initial});
  } catch (error) {
    if (!selector) selector = episodeSelector([], null, selectEpisode, {unavailable: true});
    emptyMessage.textContent = error.message;
  }
}

window.addEventListener('pagehide', () => {
  if (tracker) tracker.save();
});

init();
