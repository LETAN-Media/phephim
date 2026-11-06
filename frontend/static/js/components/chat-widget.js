/**
 * PHE PHIM AI — Floating Community Chat Widget
 * Reuses Cloudflare Community Room 1 ("Cộng Đồng Chung")
 */

(function () {
  'use strict';

  // Do not run on /cong-dong/
  if (location.pathname.startsWith('/cong-dong')) return;

  const ROOM_ID = 1;
  const HUNG_AVATAR = '/cong-dong/static/images/hung-creater.webp';

  let widgetEl = null;
  let triggerBtn = null;
  let windowEl = null;
  let messagesListEl = null;
  let statusDotEl = null;
  let formEl = null;
  let textareaEl = null;
  let sendBtnEl = null;
  let statusMsgEl = null;
  let guestPromptEl = null;

  let currentUser = null;
  let isOpen = false;
  let isLoaded = false;
  let socket = null;
  let heartbeatInterval = null;
  let pollingInterval = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let isSending = false;

  const csrfToken = () => {
    const item = document.cookie.split('; ').find(v => v.startsWith('__Host-phe_csrf='));
    return item ? decodeURIComponent(item.slice('__Host-phe_csrf='.length)) : '';
  };

  const escapeHtml = (str) => {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const formatBody = (body, isBot) => {
    const safe = escapeHtml(body);
    if (!isBot) return safe;
    // Auto-link movie links in bot messages
    return safe.replace(/\/phim\/[a-z0-9-]+\//g, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">Xem thông tin phim</a>`;
    });
  };

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const updateStatus = (state) => {
    if (!statusDotEl) return;
    statusDotEl.className = 'phe-chat-status-dot';
    if (state === 'connecting') statusDotEl.classList.add('is-connecting');
    else if (state === 'disconnected') statusDotEl.classList.add('is-disconnected');
  };

  const scrollToBottom = (smooth = true) => {
    if (!messagesListEl) return;
    messagesListEl.scrollTo({
      top: messagesListEl.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  const renderMessageNode = (msg) => {
    const isBot = !!msg.is_bot;
    const isOwn = !!(currentUser && !isBot && Number(currentUser.id) === Number(msg.user_id));
    const persona = isBot && typeof msg.ai_persona === 'string' ? msg.ai_persona.trim() : '';
    const authorName = isBot ? (persona || 'Hưng Creater') : (msg.username || 'Thành viên');
    const timeStr = formatTime(msg.created_at);

    const article = document.createElement('article');
    article.className = `phe-chat-msg${isBot ? ' bot' : ''}${isOwn ? ' is-own' : ''}`;
    article.dataset.id = String(msg.id);

    // Avatar
    let avatarContent = '';
    if (isBot && !persona) {
      avatarContent = `<img src="${HUNG_AVATAR}" alt="" onerror="this.parentElement.textContent='HC'">`;
    } else {
      const initial = Array.from(authorName)[0]?.toLocaleUpperCase('vi') || '?';
      avatarContent = escapeHtml(initial);
    }

    // Bot tag
    const botTag = isBot
      ? `<span class="phe-chat-bot-tag">${persona ? 'AI' : 'BOT CHÍNH THỨC'}</span>`
      : '';

    article.innerHTML = `
      <div class="phe-chat-msg-avatar">${avatarContent}</div>
      <div class="phe-chat-msg-content">
        <div class="phe-chat-msg-meta">
          <span class="phe-chat-msg-author">${escapeHtml(authorName)}</span>
          ${botTag}
          <span class="phe-chat-msg-time">${timeStr}</span>
        </div>
        <div class="phe-chat-msg-bubble">${formatBody(msg.body, isBot)}</div>
      </div>
    `;

    return article;
  };

  const appendOrUpdateMessage = (msg) => {
    if (!messagesListEl) return;
    const existing = messagesListEl.querySelector(`[data-id="${msg.id}"]`);
    if (existing) return;

    // Remove empty state if present
    const emptyState = messagesListEl.querySelector('.phe-chat-loading-state');
    if (emptyState) emptyState.remove();

    const node = renderMessageNode(msg);
    messagesListEl.append(node);
    scrollToBottom(true);
  };

  const removeMessage = (id) => {
    if (!messagesListEl) return;
    const target = messagesListEl.querySelector(`[data-id="${id}"]`);
    if (target) target.remove();
  };

  // Fetch current user auth state
  const checkAuth = async () => {
    try {
      const resp = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (resp.ok) {
        currentUser = await resp.json();
      } else {
        currentUser = null;
      }
    } catch {
      currentUser = null;
    }
    renderAuthState();
  };

  const renderAuthState = () => {
    if (currentUser) {
      if (formEl) formEl.style.display = 'flex';
      if (guestPromptEl) guestPromptEl.style.display = 'none';
    } else {
      if (formEl) formEl.style.display = 'none';
      if (guestPromptEl) {
        guestPromptEl.style.display = 'flex';
        const loginLink = guestPromptEl.querySelector('.phe-chat-guest-login');
        if (loginLink) {
          loginLink.href = `/dang-nhap/?next=${encodeURIComponent(location.pathname + location.search)}`;
        }
      }
    }
  };

  // Fetch messages from Room 1
  const fetchMessages = async () => {
    try {
      const resp = await fetch(`/api/community/rooms/${ROOM_ID}/messages`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!resp.ok) throw new Error('Failed to load');
      const data = await resp.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];

      messagesListEl.innerHTML = '';
      if (!messages.length) {
        messagesListEl.innerHTML = `
          <div class="phe-chat-loading-state">
            <span>Chưa có tin nhắn nào. Hãy gửi lời chào đầu tiên!</span>
          </div>`;
      } else {
        const fragment = document.createDocumentFragment();
        for (const msg of messages) {
          fragment.append(renderMessageNode(msg));
        }
        messagesListEl.append(fragment);
      }
      isLoaded = true;
      scrollToBottom(false);
    } catch {
      if (!isLoaded) {
        messagesListEl.innerHTML = `
          <div class="phe-chat-loading-state">
            <span>Không thể tải tin nhắn. Đang thử lại…</span>
          </div>`;
      }
    }
  };

  // Realtime WebSocket Connection
  const connectWebSocket = () => {
    if (socket) disconnectWebSocket();
    if (!isOpen) return;

    updateStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/community/${ROOM_ID}`;

    try {
      socket = new WebSocket(wsUrl);
    } catch {
      startPollingFallback();
      return;
    }

    socket.onopen = () => {
      reconnectAttempts = 0;
      updateStatus('connected');
      clearInterval(pollingInterval);
      pollingInterval = null;

      // Ping heartbeat every 20s
      clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send('ping');
        }
      }, 20000);
    };

    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'message' && payload.message) {
          appendOrUpdateMessage(payload.message);
        } else if (payload.type === 'delete' && payload.id) {
          removeMessage(payload.id);
        } else if (payload.type === 'refresh') {
          fetchMessages();
        }
      } catch {}
    };

    socket.onclose = (event) => {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;

      if (!isOpen) return;

      // If unauthorized (e.g. guest), fall back to periodic polling
      if (event.code === 401 || !currentUser) {
        updateStatus('connected');
        startPollingFallback();
        return;
      }

      updateStatus('disconnected');
      // Reconnect with exponential backoff
      const delay = Math.min(15000, 1000 * Math.pow(1.8, reconnectAttempts++));
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, delay);
    };

    socket.onerror = () => {
      if (socket) socket.close();
    };
  };

  const startPollingFallback = () => {
    if (pollingInterval || !isOpen) return;
    pollingInterval = setInterval(() => {
      if (isOpen && !document.hidden) {
        fetchMessages();
      }
    }, 4000);
  };

  const disconnectWebSocket = () => {
    clearTimeout(reconnectTimer);
    clearInterval(heartbeatInterval);
    clearInterval(pollingInterval);
    reconnectTimer = null;
    heartbeatInterval = null;
    pollingInterval = null;

    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = null;
    }
    updateStatus('disconnected');
  };

  // Send message
  const sendMessage = async () => {
    if (!textareaEl || isSending) return;
    const text = textareaEl.value.trim();
    if (!text) return;

    if (!currentUser) {
      statusMsgEl.textContent = 'Vui lòng đăng nhập để gửi tin nhắn.';
      return;
    }

    const csrf = csrfToken();
    if (!csrf) {
      statusMsgEl.textContent = 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
      return;
    }

    isSending = true;
    sendBtnEl.disabled = true;
    statusMsgEl.textContent = '';

    const clientId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

    try {
      const resp = await fetch(`/api/community/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf
        },
        body: JSON.stringify({
          client_id: clientId,
          body: text,
          reply_to_id: null
        })
      });

      const result = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(result.detail || 'Không thể gửi tin nhắn.');
      }

      if (result.created && result.message) {
        appendOrUpdateMessage(result.message);
      }

      textareaEl.value = '';
      textareaEl.style.height = 'auto';
      statusMsgEl.textContent = '';
      scrollToBottom(true);
    } catch (err) {
      statusMsgEl.textContent = err.message || 'Lỗi kết nối. Vui lòng thử lại.';
    } finally {
      isSending = false;
      sendBtnEl.disabled = false;
      textareaEl.focus();
    }
  };

  // Open / Close Widget
  const openWidget = async () => {
    if (isOpen) return;
    isOpen = true;
    widgetEl.classList.add('is-open');
    triggerBtn.setAttribute('aria-expanded', 'true');

    await checkAuth();
    await fetchMessages();
    connectWebSocket();

    if (window.innerWidth > 640 && textareaEl && currentUser) {
      setTimeout(() => textareaEl.focus(), 150);
    }
  };

  const closeWidget = () => {
    if (!isOpen) return;
    isOpen = false;
    widgetEl.classList.remove('is-open');
    triggerBtn.setAttribute('aria-expanded', 'false');
    disconnectWebSocket();
  };

  const toggleWidget = () => {
    if (isOpen) closeWidget();
    else openWidget();
  };

  // Init DOM and Event Listeners
  const init = () => {
    widgetEl = document.getElementById('phe-chat-widget');
    if (!widgetEl) return;

    triggerBtn = widgetEl.querySelector('.phe-chat-trigger');
    windowEl = widgetEl.querySelector('.phe-chat-window');
    messagesListEl = widgetEl.querySelector('.phe-chat-messages');
    statusDotEl = widgetEl.querySelector('.phe-chat-status-dot');
    formEl = widgetEl.querySelector('.phe-chat-form');
    textareaEl = widgetEl.querySelector('.phe-chat-textarea');
    sendBtnEl = widgetEl.querySelector('.phe-chat-send-btn');
    statusMsgEl = widgetEl.querySelector('.phe-chat-status');
    guestPromptEl = widgetEl.querySelector('.phe-chat-guest-prompt');

    const closeBtn = widgetEl.querySelector('.phe-chat-close-btn');

    if (triggerBtn) triggerBtn.addEventListener('click', toggleWidget);
    if (closeBtn) closeBtn.addEventListener('click', closeWidget);

    // Form submit
    if (formEl) {
      formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
      });
    }

    // Textarea auto-resize & keyboard submit
    if (textareaEl) {
      textareaEl.addEventListener('input', () => {
        textareaEl.style.height = 'auto';
        textareaEl.style.height = Math.min(100, textareaEl.scrollHeight) + 'px';
      });

      textareaEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Escape key closes widget
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeWidget();
      }
    });

    // Hide widget during fullscreen playback
    const handleFullscreen = () => {
      const isFs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      );
      widgetEl.classList.toggle('is-fullscreen-hidden', isFs);
    };

    document.addEventListener('fullscreenchange', handleFullscreen);
    document.addEventListener('webkitfullscreenchange', handleFullscreen);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
