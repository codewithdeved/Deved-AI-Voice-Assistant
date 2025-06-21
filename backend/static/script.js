class DevedAssistant {

    constructor() {
        this.isConnected = false;
        this.isTyping = false;
        this.apiUrl = this.getApiUrl();
        this.currentChatId = null;
        this.chats = {};
        this.userId = this.generateUserId();
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.messageIdCounter = 0;
        this.deleteTarget = null;
        this.scrollTimeout = null;
        this.isScrolling = false;
        this.audioStateCache = new Map();
        this.lastTimestamp = 0;
        this.timestampCounter = 0;


        this.initializeElements();
        this.bindEvents();
        this.checkConnection();
        this.loadChatsFromStorage();
        this.initializeDefaultChat();
        this.initializeSidebarState();
        this.startChatTitleUpdater();
    }

    getApiUrl() {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return `${protocol}//${hostname}:5000/api`;
        }
        return `${protocol}//${hostname}${port ? ':' + port : ''}/api`;
    }

    async checkConnection() {
        if (this.elements.connectionStatus) {
            this.updateConnectionStatus('connecting');
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            this.isConnected = response.ok;
            this.updateConnectionStatus(this.isConnected ? 'connected' : 'disconnected');

            if (this.elements.sendBtn) {
                this.elements.sendBtn.disabled = !this.isConnected || !this.elements.chatInput?.value.trim();
            }

            if (!this.isConnected) {
                setTimeout(() => this.checkConnection(), 5000);
            }

        } catch (error) {
            this.updateConnectionStatus('disconnected');
            this.isConnected = false;
            if (this.elements.sendBtn) {
                this.elements.sendBtn.disabled = true;
            }
            setTimeout(() => this.checkConnection(), 5000);
        }
    }

    updateConnectionStatus(status) {
        if (!this.elements.connectionStatus) return;

        const statusIndicator = this.elements.connectionStatus.querySelector('.status-indicator');
        const statusText = this.elements.connectionStatus.querySelector('.status-text');

        this.elements.connectionStatus.className = `connection-status ${status}`;
        if (statusIndicator) {
            statusIndicator.className = `status-indicator ${status}`;
        }
        if (statusText) {
            statusText.textContent = {
                connected: 'Online',
                connecting: 'Connecting...',
                disconnected: 'Offline'
            }[status] || 'Unknown';
        }
    }

    generateUserId() {
        const timestamp = this.getUniqueTimestamp();
        return `user_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    }

    generateMessageId() {
        const baseTimestamp = Date.now();
        const randomOffset = Math.random() * 0.999;
        const uniqueTimestamp = baseTimestamp + randomOffset;

        return `msg_${this.currentChatId}_${Math.floor(uniqueTimestamp)}_${Math.random().toString(36).substr(2, 8)}`;
    }

    formatTimestamp(timestamp) {
        try {
            if (!timestamp) {
                return new Date().toLocaleTimeString('en-PK', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Karachi'
                });
            }

            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return new Date().toLocaleTimeString('en-PK', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Karachi'
                });
            }

            return date.toLocaleTimeString('en-PK', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Karachi'
            });
        } catch (e) {
            console.error('Error formatting timestamp:', e);
            return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    formatRelativeTime(dateString) {
        try {
            if (!dateString) {
                return 'Just now';
            }

            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return 'Just now';
            }

            const now = new Date();
            const diffInSeconds = Math.floor((now - date) / 1000);

            if (diffInSeconds < 0) {
                return 'Just now';
            }

            const isSameDay = date.getDate() === now.getDate() &&
                date.getMonth() === now.getMonth() &&
                date.getFullYear() === now.getFullYear();

            if (diffInSeconds < 15) return 'Just now';
            if (diffInSeconds < 60) {
                return `${diffInSeconds} second${diffInSeconds === 1 ? '' : 's'} ago`;
            }

            if (isSameDay && diffInSeconds < 3600) {
                const minutes = Math.floor(diffInSeconds / 60);
                return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
            }

            const diffInHours = Math.floor(diffInSeconds / 3600);
            if (diffInHours < 24) {
                if (diffInHours === 1) return '1 hour ago';
                return `${diffInHours} hours ago`;
            }

            const diffInDays = Math.floor(diffInSeconds / 86400);
            if (diffInDays === 1) return 'Yesterday';
            if (diffInDays < 7) return `${diffInDays} days ago`;

            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) {
            console.error('Error formatting relative time:', e);
            return 'Just now';
        }
    }

    getUniqueTimestamp() {
        const now = Date.now();

        if (now === this.lastTimestamp) {
            this.timestampCounter++;
            return now + (this.timestampCounter * 0.001);
        } else {
            this.lastTimestamp = now;
            this.timestampCounter = 0;
            return now;
        }
    }

    generateChatName(chat) {
        if (chat.messages.length > 0) {
            const lastMessage = chat.messages[chat.messages.length - 1];
            return this.formatRelativeTime(lastMessage.timestamp);
        }
        return this.formatRelativeTime(chat.createdAt);
    }

    startChatTitleUpdater() {
        if (this.titleUpdateInterval) {
            clearInterval(this.titleUpdateInterval);
        }

        let debounceTimer;
        this.titleUpdateInterval = setInterval(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                Object.entries(this.chats).forEach(([chatId, chat]) => {
                    const chatItem = this.elements.chatHistory?.querySelector(`[data-chat-id="${chatId}"]`);
                    if (chatItem) {
                        const titleElement = chatItem.querySelector('.chat-title-text');
                        if (titleElement) {
                            const currentBadge = chatItem.querySelector('.current-badge');
                            const newTitle = this.generateChatName(chat);

                            if (titleElement.textContent !== newTitle) {
                                titleElement.textContent = this.escapeHtml(newTitle);
                                if (currentBadge && !titleElement.contains(currentBadge)) {
                                    titleElement.parentNode.appendChild(currentBadge);
                                }
                            }
                        }
                    }
                });
            }, 100);
        }, 10000);
    }

    initializeElements() {
        this.elements = {
            chatMessages: document.getElementById('chatMessages'),
            chatInput: document.getElementById('chatInput'),
            sendBtn: document.getElementById('sendBtn'),
            recordBtn: document.getElementById('recordBtn'),
            sidebar: document.getElementById('sidebar'),
            sidebarExpandBtn: document.getElementById('sidebar-expand-btn'),
            sidebarToggle: document.getElementById('sidebarToggle'),
            connectionStatus: document.getElementById('connectionStatus'),
            newChatBtn: document.getElementById('newChatBtn'),
            chatHistory: document.getElementById('chatHistory'),
            profileDropdown: document.querySelector('.profile-dropdown'),
            dropdownMenu: document.querySelector('.dropdown-menu'),
            deleteAllChats: document.getElementById('delete-all-chats'),
            modalDeleteBtn: document.getElementById('modalDeleteBtn'),
            startScreen: document.getElementById('start-screen')
        };

        Object.entries(this.elements).forEach(([name, element]) => {
            if (!element) {
                console.warn(`Element '${name}' not found in DOM`);
            }
        });
    }

    bindEvents() {
        const { sendBtn, chatInput, sidebarToggle, newChatBtn, chatHistory, profileDropdown, deleteAllChats, sidebarExpandBtn } = this.elements;

        if (this.elements.sendBtn) {
            this.elements.sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.enqueueMessage();
                if (this.elements.chatInput) this.elements.chatInput.blur();
            });
        }

        if (this.elements.chatInput) {
            this.elements.chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.enqueueMessage();
                    if (this.elements.chatInput) this.elements.chatInput.blur();
                }
            });
        }

        chatInput?.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            const maxHeight = 300;
            const newHeight = Math.min(chatInput.scrollHeight, maxHeight);
            chatInput.style.height = newHeight + 'px';
            if (newHeight === maxHeight) {
                chatInput.style.overflowY = 'auto';
            } else {
                chatInput.style.overflowY = 'hidden';
            }
            if (sendBtn) {
                sendBtn.disabled = !chatInput.value.trim() || !this.isConnected;
            }
        });

        sidebarExpandBtn?.addEventListener('click', () => this.expandSidebar());
        sidebarToggle?.addEventListener('click', () => this.toggleSidebar());

        newChatBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.createNewChat();
            if (window.innerWidth <= 768) {
                this.expandSidebar();
            }
        });

        chatHistory?.addEventListener('click', (e) => {
            const chatItem = e.target.closest('.chat-item');
            if (chatItem) {
                const chatId = chatItem.getAttribute('data-chat-id');
                this.switchToChat(chatId);
                if (window.innerWidth <= 768) {
                    this.collapseSidebar();
                }
            }
        });

        profileDropdown?.addEventListener('click', () => this.toggleProfileDropdown());

        deleteAllChats?.addEventListener('click', () => {
            this.deleteTarget = 'all';
            this.showConfirmModal('Are you sure you want to delete all chats?');
        });

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const savedTheme = localStorage.getItem('deved_theme') || 'light';
            themeToggle.checked = savedTheme === 'dark';
            document.documentElement.setAttribute('data-theme', savedTheme);

            themeToggle.addEventListener('change', () => {
                this.toggleTheme();
            });
        }

        document.addEventListener('click', (e) => {
            const profileDropdown = this.elements.profileDropdown;
            const dropdownMenu = this.elements.dropdownMenu;
            if (profileDropdown && dropdownMenu && !profileDropdown.contains(e.target) && !dropdownMenu.contains(e.target)) {
                if (dropdownMenu.classList.contains('active')) {
                    dropdownMenu.classList.remove('active');
                }
            }
            if (e.target.closest('audio') || e.target.closest('.audio-player')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        });

        document.addEventListener('submit', (e) => {
            if (e.target.closest('.chat-input-area')) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        window.addEventListener('resize', () => this.handleResize());
    }

    handleResize() {
        if (window.innerWidth <= 768) {
            this.collapseSidebar();
        } else {
            this.expandSidebar();
        }
    }

    toggleSidebar() {
        if (this.elements.sidebar.classList.contains('collapsed')) {
            this.expandSidebar();
        } else {
            this.collapseSidebar();
        }
    }

    enqueueMessage() {
        const message = this.elements.chatInput?.value.trim();
        if (!message || !this.isConnected) return;

        this.messageQueue.push(message);
        this.elements.chatInput.value = '';
        this.elements.chatInput.style.height = 'auto';
        if (this.elements.sendBtn) this.elements.sendBtn.disabled = true;
        if (this.elements.chatInput) this.elements.chatInput.blur();

        this.processMessageQueue();
    }

    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        this.isProcessingQueue = true;

        const message = this.messageQueue.shift();
        await this.sendMessage(message);

        this.isProcessingQueue = false;
        if (this.messageQueue.length > 0) {
            setTimeout(() => this.processMessageQueue(), 100);
        }
    }

    loadChatsFromStorage() {
        try {
            const savedChats = localStorage.getItem('deved_chats');
            if (savedChats) {
                this.chats = JSON.parse(savedChats);
                this.elements.chatHistory.innerHTML = '';

                const sortedChats = Object.entries(this.chats)
                    .sort((a, b) => new Date(b[1].lastUpdated) - new Date(a[1].lastUpdated))
                    .slice(0, 50);

                sortedChats.forEach(([chatId, chat]) => {
                    if (!chat.messages) chat.messages = [];
                    const snippetText = chat.customSnippet || chat.messages?.slice().reverse().find(m => m.sender !== 'system')?.text || 'New conversation';
                    this.addChatToHistory(chatId, this.generateChatName(chat), snippetText, false);
                });

            }
        } catch (error) {
            console.error('Error loading chats:', error);
            this.chats = {};
        }
    }

    saveChatsToStorage() {
        try {
            const chatsToSave = {};
            Object.keys(this.chats).forEach(chatId => {
                const chat = this.chats[chatId];
                chatsToSave[chatId] = {
                    id: chatId,
                    customSnippet: chat.customSnippet,
                    messages: chat.messages || [],
                    createdAt: chat.createdAt || new Date().toISOString(),
                    lastUpdated: chat.lastUpdated || new Date().toISOString()
                };
            });

            localStorage.setItem('deved_chats', JSON.stringify(chatsToSave));
        } catch (error) {
            console.error('Error saving chats:', error);
        }
    }

    initializeDefaultChat() {
        const savedChatId = localStorage.getItem('currentChatId');
        const hasChats = Object.keys(this.chats).length > 0;

        if (savedChatId && this.chats[savedChatId] && this.isPageRefresh()) {
            this.currentChatId = savedChatId;
            this.loadCurrentChat();
            this.updateActiveChatInHistory(savedChatId);
            if (this.elements.startScreen) {
                this.elements.startScreen.style.display = 'none';
            }
        } else {
            this.currentChatId = null;
            localStorage.removeItem('currentChatId');
            if (this.elements.chatMessages) {
                this.elements.chatMessages.innerHTML = '';
            }
            if (this.elements.startScreen) {
                this.elements.startScreen.style.display = 'flex';
            }
            this.clearActiveChatIndicators();
        }
    }

    isPageRefresh() {
        return performance.navigation.type === performance.navigation.TYPE_RELOAD ||
            (performance.getEntriesByType('navigation')[0] &&
                performance.getEntriesByType('navigation')[0].type === 'reload');
    }

    clearActiveChatIndicators() {
        if (!this.elements.chatHistory) return;

        const chatItems = this.elements.chatHistory.querySelectorAll('.chat-item');
        chatItems.forEach(item => {
            item.classList.remove('active');
            const badge = item.querySelector('.current-badge');
            if (badge) badge.remove();
        });
    }

    createNewChat() {
        const baseTimestamp = Date.now();
        const randomOffset = Math.random() * 0.999;
        const uniqueTimestamp = baseTimestamp + randomOffset;

        const chatId = `chat_${Math.floor(uniqueTimestamp)}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = new Date(uniqueTimestamp).toISOString();

        this.chats[chatId] = {
            id: chatId,
            customSnippet: null,
            messages: [],
            createdAt: createdAt,
            lastUpdated: createdAt
        };

        const chatItems = this.elements.chatHistory?.querySelectorAll('.chat-item') || [];
        chatItems.forEach(item => {
            item.classList.remove('active');
            const badge = item.querySelector('.current-badge');
            if (badge) badge.remove();
        });

        this.currentChatId = chatId;
        localStorage.setItem('currentChatId', this.currentChatId);

        this.addChatToHistory(chatId, this.generateChatName(this.chats[chatId]), 'New conversation', true);
        this.saveChatsToStorage();

        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = '';
        }

        if (this.elements.startScreen) {
            this.elements.startScreen.style.display = 'none';
        }

        this.switchToChat(chatId);
    }

    addChatToHistory(chatId, title, snippet = 'New conversation', scrollToItem = true) {
        if (!this.elements.chatHistory) return;

        const existingItem = this.elements.chatHistory.querySelector(`[data-chat-id="${chatId}"]`);

        if (existingItem && chatId === this.currentChatId) {
            const titleElement = existingItem.querySelector('.chat-title-text');
            const snippetElement = existingItem.querySelector('.chat-snippet');

            if (titleElement) {
                titleElement.textContent = this.escapeHtml(title);
            }
            if (snippetElement) {
                snippetElement.textContent = this.escapeHtml(snippet);
            }

            existingItem.classList.add('active');
            const titleContainer = existingItem.querySelector('.chat-title');
            if (titleContainer && !titleContainer.querySelector('.current-badge')) {
                titleContainer.insertAdjacentHTML('beforeend', '<span class="current-badge">Current</span>');
            }
            return;
        }

        if (existingItem) existingItem.remove();

        const chat = this.chats[chatId];
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item`;
        if (chatId === this.currentChatId) {
            chatItem.classList.add('active');
        }
        chatItem.setAttribute('data-chat-id', chatId);

        const currentBadge = chatId === this.currentChatId ? '<span class="current-badge">Current</span>' : '';

        chatItem.innerHTML = `
        <div class="chat-preview">
            <div class="chat-title">
                <span class="chat-title-text">${this.escapeHtml(title)}</span>
                ${currentBadge}
            </div>
            <div class="chat-snippet-area">
                <div class="chat-snippet">${this.escapeHtml(snippet)}</div>
                <div class="chat-snippet-actions hidden">
                    <button class="cancel-rename-chat" title="Cancel">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="stroke-[2] text-fg-primary"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor"></path></svg>
                    </button>
                    <button class="done-rename-chat" title="Save">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check text-primary"><path d="M20 6 9 17l-5-5"></path></svg>
                    </button>
                </div>
            </div>
        </div>
        <div class="chat-actions">
            <button class="chat-action-btn rename-chat" title="Edit Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="chat-action-btn delete-chat" title="Delete Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

        if (chatId === this.currentChatId) {
            this.elements.chatHistory.insertBefore(chatItem, this.elements.chatHistory.firstChild);
        } else {
            const chatItems = Array.from(this.elements.chatHistory.querySelectorAll('.chat-item:not(.active)'));
            const chatTimestamps = chatItems.map(item => ({
                id: item.getAttribute('data-chat-id'),
                timestamp: new Date(this.chats[item.getAttribute('data-chat-id')].lastUpdated)
            }));
            chatTimestamps.push({ id: chatId, timestamp: new Date(chat.lastUpdated) });
            chatTimestamps.sort((a, b) => b.timestamp - a.timestamp);

            const insertIndex = chatTimestamps.findIndex(item => item.id === chatId);
            if (insertIndex === 0) {
                const currentChatItem = this.elements.chatHistory.querySelector('.chat-item.active');
                if (currentChatItem) {
                    this.elements.chatHistory.insertBefore(chatItem, currentChatItem.nextSibling);
                } else {
                    this.elements.chatHistory.insertBefore(chatItem, this.elements.chatHistory.firstChild);
                }
            } else {
                const previousItem = this.elements.chatHistory.querySelector(`[data-chat-id="${chatTimestamps[insertIndex - 1].id}"]`);
                if (previousItem) {
                    this.elements.chatHistory.insertBefore(chatItem, previousItem.nextSibling);
                }
            }
        }

        const renameButton = chatItem.querySelector('.rename-chat');
        renameButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editSnippet(chatId, chatItem);
        });

        chatItem.querySelector('.delete-chat')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteTarget = { type: 'single', chatId };
            this.showConfirmModal('Are you sure you want to delete this chat?');
        });

        if (scrollToItem && chatId !== this.currentChatId) {
            chatItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    editSnippet(chatId, chatItem) {
        const chat = this.chats[chatId];
        if (!chat || !chatItem) return;

        const snippetElement = chatItem.querySelector('.chat-snippet');
        const snippetActions = chatItem.querySelector('.chat-snippet-actions');
        const originalSnippet = chat.customSnippet || snippetElement.textContent;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalSnippet;
        input.className = 'chat-snippet-input';
        input.style.cssText = 'width:100%;padding:2px;border:none;outline:none;background:var(--background-color);color:var(--text-color)';

        snippetElement.replaceWith(input);
        snippetActions.classList.remove('hidden');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        const saveSnippet = () => {
            const newSnippet = input.value.trim();
            const hasChanged = newSnippet !== originalSnippet;

            if (newSnippet) {
                chat.customSnippet = newSnippet;
                snippetElement.textContent = this.escapeHtml(newSnippet);
            } else {
                chat.customSnippet = null;
                const defaultSnippet = chat.messages?.slice().reverse().find(m => m.sender !== 'system')?.text || 'New conversation';
                snippetElement.textContent = this.escapeHtml(defaultSnippet);
            }

            if (hasChanged) {
                chat.lastUpdated = new Date().toISOString();
            }

            this.saveChatsToStorage();
            input.replaceWith(snippetElement);
            snippetActions.classList.add('hidden');
        };

        const cancelSnippet = () => {
            snippetElement.textContent = this.escapeHtml(originalSnippet);
            input.replaceWith(snippetElement);
            snippetActions.classList.add('hidden');
        };

        const doneButton = chatItem.querySelector('.done-rename-chat');
        const cancelButton = chatItem.querySelector('.cancel-rename-chat');

        const doneHandler = (e) => {
            e.stopPropagation();
            saveSnippet();
            cleanup();
        };

        const cancelHandler = (e) => {
            e.stopPropagation();
            cancelSnippet();
            cleanup();
        };

        const outsideClickHandler = (e) => {
            if (!input.contains(e.target) && !snippetActions.contains(e.target)) {
                cancelSnippet();
                cleanup();
            }
        };

        const cleanup = () => {
            doneButton.removeEventListener('click', doneHandler);
            cancelButton.removeEventListener('click', cancelHandler);
            document.removeEventListener('click', outsideClickHandler);
        };

        doneButton.addEventListener('click', doneHandler);
        cancelButton.addEventListener('click', cancelHandler);
        document.addEventListener('click', outsideClickHandler);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveSnippet();
                cleanup();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelSnippet();
                cleanup();
            }
        });

        chatItem.querySelector('.chat-snippet-area').addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    deleteSingleChat(chatId) {
        const isLastChat = Object.keys(this.chats).length === 1;
        const wasCurrentChat = chatId === this.currentChatId;

        delete this.chats[chatId];
        this.saveChatsToStorage();

        const chatItem = this.elements.chatHistory.querySelector(`[data-chat-id="${chatId}"]`);
        if (chatItem) chatItem.remove();

        this.currentChatId = null;
        localStorage.removeItem('currentChatId');
        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = '';
        }
        if (this.elements.startScreen) {
            this.elements.startScreen.style.display = 'flex';
        }
        this.clearActiveChatIndicators();
    }

    deleteAllChats() {
        this.chats = {};
        localStorage.removeItem('deved_chats');
        localStorage.removeItem('currentChatId');

        if (this.elements.chatHistory) {
            this.elements.chatHistory.innerHTML = '';
        }
        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = '';
        }
        this.currentChatId = null;

        if (this.elements.startScreen) {
            this.elements.startScreen.style.display = 'flex';
        }
    }

    switchToChat(chatId) {
        if (!chatId || !this.chats[chatId]) {
            this.currentChatId = null;
            localStorage.removeItem('currentChatId');
            if (this.elements.chatMessages) {
                this.elements.chatMessages.innerHTML = '';
            }
            if (this.elements.startScreen) {
                this.elements.startScreen.style.display = 'flex';
            }
            return;
        }

        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = '';
        }

        if (this.elements.startScreen) {
            this.elements.startScreen.style.display = 'none';
        }

        const chatItems = this.elements.chatHistory?.querySelectorAll('.chat-item') || [];
        chatItems.forEach(item => {
            item.classList.remove('active');
            const badge = item.querySelector('.current-badge');
            if (badge) badge.remove();
        });

        this.currentChatId = chatId;
        localStorage.setItem('currentChatId', this.currentChatId);

        const activeChatItem = this.elements.chatHistory?.querySelector(`[data-chat-id="${chatId}"]`);
        if (activeChatItem) {
            activeChatItem.classList.add('active');
            const titleElement = activeChatItem.querySelector('.chat-title');
            if (titleElement && !titleElement.querySelector('.current-badge')) {
                titleElement.insertAdjacentHTML('beforeend', '<span class="current-badge">Current</span>');
            }
        }

        this.loadCurrentChat();
        console.log(`Switched to chat: ${chatId}`);
    }

    updateActiveChatInHistory(activeChatId) {
        if (!this.elements.chatHistory) return;

        const chatItems = this.elements.chatHistory.querySelectorAll('.chat-item');
        chatItems.forEach(item => {
            if (item.getAttribute('data-chat-id') === activeChatId) {
                item.classList.add('active');
                const titleElement = item.querySelector('.chat-title');
                if (titleElement && !titleElement.querySelector('.current-badge')) {
                    titleElement.insertAdjacentHTML('beforeend', '<span class="current-badge">Current</span>');
                }
            } else {
                item.classList.remove('active');
                const badge = item.querySelector('.current-badge');
                if (badge) badge.remove();
            }
        });
    }

    loadCurrentChat() {
        if (!this.elements.chatMessages) {
            return;
        }

        const currentChat = this.chats[this.currentChatId];
        if (!currentChat) {
            this.createNewChat();
            return;
        }

        if (!currentChat.messages) {
            currentChat.messages = [];
        }

        const currentMessages = Array.from(this.elements.chatMessages.querySelectorAll('.message')).map(
            (el) => el.getAttribute('data-message-id')
        );
        const chatMessageIds = currentChat.messages.map((msg) => msg.id);

        if (currentMessages.join() !== chatMessageIds.join()) {

            this.cacheAudioStates();
            this.elements.chatMessages.innerHTML = '';
            this.hideTypingIndicator();

            currentChat.messages.forEach((message) => {
                this.displayMessage(
                    message.text,
                    message.sender,
                    message.timestamp,
                    message.messageType,
                    message.audioPath,
                    message.id
                );
            });

            this.restoreAudioStates();

        }

        if (this.elements.chatInput) {
            this.elements.chatInput.value = '';
            this.elements.chatInput.style.height = 'auto';
        }
        if (this.elements.sendBtn) {
            this.elements.sendBtn.disabled = !this.isConnected;
        }

        this.scrollToBottom();
    }

    cacheAudioStates() {
        const audioElements = this.elements.chatMessages.querySelectorAll('audio');
        this.audioStateCache.clear();
        audioElements.forEach((audio) => {
            const messageId = audio.closest('.message')?.getAttribute('data-message-id');
            if (messageId) {
                this.audioStateCache.set(messageId, {
                    currentTime: audio.currentTime,
                    paused: audio.paused,
                    volume: audio.volume
                });
            }
        });
    }

    restoreAudioStates() {
        const audioElements = this.elements.chatMessages.querySelectorAll('audio');
        audioElements.forEach((audio) => {
            const messageId = audio.closest('.message')?.getAttribute('data-message-id');
            const state = this.audioStateCache.get(messageId);
            if (state) {
                audio.currentTime = state.currentTime;
                audio.volume = state.volume;
                if (!state.paused) {
                    audio.play().catch((err) => console.warn('Failed to restore audio playback:', err));
                }
            }
        });
    }

    expandSidebar() {
        const { sidebar, sidebarExpandBtn, sidebarToggle } = this.elements;
        if (!sidebar || !sidebarExpandBtn || !sidebarToggle) {
            return;
        }
        sidebar.classList.add('expanded');
        sidebar.classList.remove('collapsed');
        sidebarExpandBtn.style.display = 'none';
        sidebarToggle.checked = false;
        document.body.classList.add('sidebar-overlay');
        localStorage.setItem('sidebar_state', 'open');
    }

    collapseSidebar() {
        const { sidebar, sidebarExpandBtn, sidebarToggle } = this.elements;
        if (!sidebar || !sidebarExpandBtn || !sidebarToggle) {
            return;
        }
        sidebar.classList.add('collapsed');
        sidebar.classList.remove('expanded');
        sidebarExpandBtn.style.display = 'block';
        sidebarToggle.checked = true;
        document.body.classList.remove('sidebar-overlay');
        localStorage.setItem('sidebar_state', 'closed');
    }

    initializeSidebarState() {
        const { sidebar, sidebarExpandBtn, sidebarToggle } = this.elements;
        if (!sidebar || !sidebarExpandBtn || !sidebarToggle) {
            return;
        }

        if (window.innerWidth <= 768) {
            this.collapseSidebar();
        } else {
            this.expandSidebar();
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('deved_theme', newTheme);

        const themeToggle = document.getElementById('themeToggle');
        const themeSlider = document.getElementById('theme-slider');

        if (themeToggle && themeSlider) {
            themeToggle.checked = newTheme === 'dark';
            themeSlider.title = newTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }
    }

    toggleProfileDropdown() {
        if (!this.elements.profileDropdown) {
            return;
        }

        this.elements.dropdownMenu.classList.toggle('active');
    }

    async sendMessage(message) {
        if (!message || !this.isConnected) {
            return;
        }

        if (!this.currentChatId || !this.chats[this.currentChatId]) {
            this.createNewChat();
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const currentChat = this.chats[this.currentChatId];
        if (!currentChat.messages) currentChat.messages = [];

        const baseTimestamp = Date.now();
        const userRandomOffset = Math.random() * 0.5;
        const userUniqueTimestamp = baseTimestamp + userRandomOffset;
        const timestamp = new Date(userUniqueTimestamp).toISOString();
        const userMessageId = this.generateMessageId();

        const userMessage = {
            id: userMessageId,
            text: message,
            sender: 'user',
            timestamp,
            messageType: null,
            audioPath: null
        };

        currentChat.messages.push(userMessage);
        currentChat.lastUpdated = timestamp;
        this.saveChatsToStorage();

        this.displayMessage(message, 'user', timestamp, null, null, userMessageId);
        this.showTypingIndicator();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(`${this.apiUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    user_id: this.userId,
                    chat_id: this.currentChatId
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();

            this.hideTypingIndicator();

            if (data.error) {
                throw new Error(data.error);
            }

            const assistantMessage = data.response || "I'm sorry, I couldn't generate a response.";

            const assistantBaseTimestamp = Date.now();
            const assistantRandomOffset = 0.5 + (Math.random() * 0.5);
            const assistantUniqueTimestamp = assistantBaseTimestamp + assistantRandomOffset;
            const responseTimestamp = data.timestamp || new Date(assistantUniqueTimestamp).toISOString();
            const assistantMessageId = this.generateMessageId();

            const assistantMessageData = {
                id: assistantMessageId,
                text: assistantMessage,
                sender: 'assistant',
                timestamp: responseTimestamp,
                messageType: null,
                audioPath: data.audio_path || null
            };

            // Only add the assistant message if it's not already present
            const existingAssistantMsg = currentChat.messages.find(msg => msg.id === assistantMessageId);
            if (!existingAssistantMsg) {
                currentChat.messages.push(assistantMessageData);
            }
            currentChat.lastUpdated = responseTimestamp;

            const snippetText = currentChat.customSnippet || assistantMessage;
            this.updateChatSnippet(this.currentChatId, snippetText);

            this.displayMessage(
                assistantMessage,
                'assistant',
                responseTimestamp,
                null,
                data.audio_path || null,
                assistantMessageId
            );

            this.updateActiveChatInHistory(this.currentChatId);
            this.saveChatsToStorage();

        } catch (error) {
            this.hideTypingIndicator();

            const errorMessageId = this.generateMessageId();
            const errorBaseTimestamp = Date.now();
            const errorRandomOffset = Math.random() * 0.999;
            const errorUniqueTimestamp = errorBaseTimestamp + errorRandomOffset;
            const errorTimestamp = new Date(errorUniqueTimestamp).toISOString();

            this.displayMessage(
                `Sorry, I encountered an error: ${error.message || 'Please try again.'}`,
                'assistant',
                errorTimestamp,
                'error',
                null,
                errorMessageId
            );

            if (currentChat.messages[currentChat.messages.length - 1].sender === 'user') {
                currentChat.messages.pop();
            }
            this.saveChatsToStorage();

        } finally {
            this.hideTypingIndicator();
            if (this.elements.sendBtn && this.elements.chatInput) {
                this.elements.sendBtn.disabled = !this.elements.chatInput.value.trim() || !this.isConnected;
            }
        }
    }

    updateChatSnippet(chatId, message) {

        if (!this.elements.chatHistory) return;

        const chatItem = this.elements.chatHistory.querySelector(`[data-chat-id="${chatId}"]`);

        if (chatItem) {

            const snippet = chatItem.querySelector('.chat-snippet');

            if (snippet) {
                const truncated = message.length > 50
                    ? message.substring(0, 50) + '...'
                    : message;
                if (snippet.textContent !== truncated) {
                    snippet.textContent = this.escapeHtml(truncated);
                }
            }

            const chatNameElement = chatItem.querySelector('.chat-title-text');
            if (chatNameElement) {
                const newTitle = this.generateChatName(this.chats[chatId]);
                if (chatNameElement.textContent !== newTitle) {
                    chatNameElement.textContent = this.escapeHtml(newTitle);
                }
            }

            const chat = this.chats[chatId];
            if (chatId === this.currentChatId) {
                if (chatItem !== this.elements.chatHistory.firstChild) {
                    this.elements.chatHistory.insertBefore(chatItem, this.elements.chatHistory.firstChild);
                }
            }
        }

        this.saveChatsToStorage();
    }

    displayMessage(text, sender, timestamp = null, messageType = null, audioPath = null, messageId = null) {
        if (!this.elements.chatMessages) return;

        try {
            const finalMessageId = messageId || this.generateMessageId();
            const existingMessage = this.elements.chatMessages.querySelector(`[data-message-id="${finalMessageId}"]`);

            if (existingMessage) {
                const bubble = existingMessage.querySelector('.message-bubble');
                if (bubble && bubble.innerHTML !== this.escapeHtml(text)) {
                    bubble.innerHTML = this.escapeHtml(text);
                }
                if (audioPath && sender === 'assistant' && !existingMessage.querySelector('audio')) {
                    const audioHtml = `
                        <div class="audio-player">
                            <audio controls preload="metadata">
                                <source src="${this.apiUrl}/audio/${encodeURIComponent(audioPath)}" type="audio/mpeg">
                                <source src="${this.apiUrl}/audio/${encodeURIComponent(audioPath)}" type="audio/wav">
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                    `;
                    const content = existingMessage.querySelector('.message-content');
                    if (content) {
                        content.insertBefore(new DOMParser().parseFromString(audioHtml, 'text/html').body.firstChild, content.querySelector('.message-actions'));
                    }
                }
                this.scrollToBottom();
                return;
            }

            const time = this.formatTimestamp(timestamp);
            const avatarText = sender === 'user' ? 'U' : sender === 'system' ? 'S' : 'D';
            let audioHtml = '';

            if (audioPath && sender === 'assistant') {
                audioHtml = `
                    <div class="audio-player">
                        <audio controls preload="metadata">
                            <source src="${this.apiUrl}/audio/${encodeURIComponent(audioPath)}" type="audio/mpeg">
                            <source src="${this.apiUrl}/audio/${encodeURIComponent(audioPath)}" type="audio/wav">
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                `;
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${sender}`;
            if (messageType) messageDiv.classList.add(`message-${messageType}`);
            messageDiv.setAttribute('data-message-id', finalMessageId);

            const copySvg = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-md-heavy">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M7 5C7 3.34315 8.34315 2 10 2H19C20.6569 2 22 3.34315 22 5V14C22 15.6569 20.6569 17 19 17H17V19C17 20.6569 15.6569 22 14 22H5C3.34315 22 2 20.6569 2 19V10C2 8.34315 3.34315 7 5 7H7V5ZM9 7H14C15.6569 7 17 8.34315 17 10V15H19C19.5523 15 20 14.5523 20 14V5C20 4.44772 19.5523 4 19 4H10C9.44772 4 9 4.44772 9 5V7ZM5 9C4.44772 9 4 9.44772 4 10V19C4 19.5523 4.44772 20 5 20H14C14.5523 20 15 19.5523 15 19V10C15 9.44772 14.5523 9 14 9H5Z" fill="currentColor"></path>
                </svg>
            `;
            const checkSvg = `
                <svg class="check-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-md-heavy">
                    <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;

            messageDiv.innerHTML = `
                <div class="message-avatar">${avatarText}</div>
                <div class="message-content">
                    <div class="message-bubble">${this.escapeHtml(text)}</div>
                    ${audioHtml}
                    <div class="message-actions">
                        <span class="message-time">${time}</span>
                        <button type="button" class="message-copy" title="Copy">
                            ${copySvg}
                        </button>
                    </div>
                </div>
            `;

            this.elements.chatMessages.appendChild(messageDiv);

            const copyButton = messageDiv.querySelector('.message-copy');
            if (copyButton) {
                copyButton.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(text);
                        copyButton.title = 'Copied';
                        copyButton.innerHTML = checkSvg;
                        setTimeout(() => {
                            copyButton.title = 'Copy';
                            copyButton.innerHTML = copySvg;
                        }, 2000);
                    } catch (err) {
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'message error';
                        errorDiv.textContent = 'Failed to copy message. Please try again.';
                        this.elements.chatMessages.appendChild(errorDiv);
                        setTimeout(() => errorDiv.remove(), 3000);
                    }
                });
            }

            this.scrollToBottom();

        } catch (error) {
            console.error('Error displaying message:', error);
        }
    }

    showTypingIndicator() {
        if (this.isTyping || !this.elements.chatMessages) return;
        this.hideTypingIndicator();

        this.isTyping = true;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message assistant';
        typingDiv.id = 'typingIndicator';
        typingDiv.innerHTML = `
        <div class="message-avatar">D</div>
        <div class="message-content">
            <div class="message-bubble typing-bubble">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
                <span class="typing-text">Deved is typing...</span>
            </div>
        </div>
    `;

        this.elements.chatMessages.appendChild(typingDiv);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const typing = document.getElementById('typingIndicator');
        if (typing) {
            typing.remove();
        }
        this.isTyping = false;
    }

    scrollToBottom() {
        if (!this.elements.chatMessages) return;

        const scrollToBottomInternal = () => {
            const { scrollHeight, clientHeight, scrollTop } = this.elements.chatMessages;
            const targetScroll = scrollHeight - clientHeight;
            if (Math.abs(scrollTop - targetScroll) > 1) {
                this.elements.chatMessages.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth'
                });
            }
        };

        const observer = new MutationObserver(() => {
            scrollToBottomInternal();
            observer.disconnect();
        });

        observer.observe(this.elements.chatMessages, {
            childList: true,
            subtree: true,
            attributes: true
        });

        requestAnimationFrame(scrollToBottomInternal);

        setTimeout(() => {
            scrollToBottomInternal();
            observer.disconnect();
        }, 300);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    cleanup() {
        this.saveChatsToStorage();
        this.isConnected = false;
        this.hideTypingIndicator();

        if (this.titleUpdateInterval) {
            clearInterval(this.titleUpdateInterval);
            this.titleUpdateInterval = null;
        }
    }

    showConfirmModal(message) {
        let modal = document.getElementById('confirmModal');
        const modalMessage = modal.querySelector('#modalMessage');
        const cancelBtn = modal.querySelector('#modalCancelBtn');
        const deleteBtn = this.elements.modalDeleteBtn;

        modalMessage.textContent = message;
        modal.style.display = 'flex';

        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        this.elements.modalDeleteBtn = newDeleteBtn;

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            this.deleteTarget = null;
        };

        newDeleteBtn.onclick = () => {
            if (this.deleteTarget === 'all') {
                this.deleteAllChats();
            } else if (this.deleteTarget?.type === 'single') {
                this.deleteSingleChat(this.deleteTarget.chatId);
            }
            modal.style.display = 'none';
            this.deleteTarget = null;
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                this.deleteTarget = null;
            }
        };
    }

}

document.addEventListener('DOMContentLoaded', () => {

    const savedTheme = localStorage.getItem('deved_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.style.visibility = 'visible';

    try {
        window.assistant = new DevedAssistant();
    } catch (error) {
        console.error('Failed to initialize Deved Assistant:', error);
    }

});

window.addEventListener('beforeunload', () => {
    if (window.assistant) {
        window.assistant.cleanup();
    }
});

window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
});

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});