const vscode = acquireVsCodeApi();
let currentTheme = 'light';
let levelTimers = {};

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', currentTheme);
    const t = document.querySelector('.theme-toggle');
    if (t) t.textContent = currentTheme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
    vscode.postMessage({ command: 'toggleTheme', theme: currentTheme });
}

let webviewRequestInProgress = false;

function requestLevel(levelId) {
    console.log('Requesting level:', levelId);

    // Prevent double-clicks on webview side
    if (webviewRequestInProgress) {
        console.log('Webview: Request already in progress, ignoring click');
        return;
    }

    const button = document.getElementById('level-' + levelId);
    if (button && button.classList.contains('disabled')) return;

    webviewRequestInProgress = true;
    showLoading();
    vscode.postMessage({ command: 'requestLevel', level: levelId });

    // UI fallback if host never replies
    const timeoutMs = 30000;
    setTimeout(() => {
        const el = document.getElementById('responseContent');
        const stillLoading = el && el.textContent && el.textContent.includes('Sterling is thinking');
        if (stillLoading) {
            showError('Request timed out. Please try again or check your API key.');
        }
        webviewRequestInProgress = false; // Clear on timeout
    }, timeoutMs);
}

// Bind clicks (avoid inline handlers)
(function bindLevelButtons() {
    const concept = document.getElementById('level-concept');
    const how = document.getElementById('level-how');
    const code = document.getElementById('level-code');

    // Remove any existing click handlers and add new ones
    if (concept) {
        concept.replaceWith(concept.cloneNode(true));
        const newConcept = document.getElementById('level-concept');
        newConcept.addEventListener('click', () => requestLevel('concept'));
    }
    if (how) {
        how.replaceWith(how.cloneNode(true));
        const newHow = document.getElementById('level-how');
        newHow.addEventListener('click', () => {
            if (!newHow.classList.contains('disabled')) requestLevel('how');
        });
    }
    if (code) {
        code.replaceWith(code.cloneNode(true));
        const newCode = document.getElementById('level-code');
        newCode.addEventListener('click', () => {
            if (!newCode.classList.contains('disabled')) requestLevel('code');
        });
    }
})();

function showLoading() {
    const responseArea = document.getElementById('responseArea');
    const responseTitle = document.getElementById('responseTitle');
    const responseContent = document.getElementById('responseContent');
    if (responseTitle) responseTitle.textContent = 'Working…';
    if (responseContent) {
        responseContent.innerHTML = '<div class="loading"><div class="spinner">🤔</div><h3>Sterling is thinking...</h3><p>Generating your personalized learning response</p></div>';
    }
    responseArea.classList.add('show');
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
    setTimeout(() => errorDiv.classList.remove('show'), 5000);
}

function unlockNextLevel(currentIndex) {
    const levels = ['concept', 'how', 'code'];
    if (currentIndex < levels.length - 1) {
        const nextLevel = levels[currentIndex + 1];
        const nextButton = document.getElementById('level-'  + nextLevel);
        if (nextButton) {
            // Show countdown immediately
            const statusSpan = nextButton.querySelector('.level-status');
            let countdown = 60;

            const timer = setInterval(() => {
                // If already unlocked somewhere else, mark READY and stop
                if (!nextButton.classList.contains('disabled')) {
                    clearInterval(timer);
                    statusSpan.textContent = 'AVAILABLE';
                    statusSpan.className = 'level-status available';
                    return;
                }

                if (countdown > 0) {
                    statusSpan.textContent = `WAIT ${countdown}s`;
                    statusSpan.title = 'Take time to review and understand the previous response before moving to the next level. This helps reinforce your learning!';
                    countdown--;
                } else {
                    // Actually unlock the button when countdown reaches 0
                    clearInterval(timer);
                    nextButton.classList.remove('disabled');
                    statusSpan.textContent = 'AVAILABLE';
                    statusSpan.className = 'level-status available';
                    statusSpan.title = 'Ready to proceed to the next level';
                }
            }, 1000);
        }
    }
}

function sendFollowUp() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    addChatMessage(question, 'user');
    input.value = '';

    vscode.postMessage({ command: 'askFollowUp', question: question });
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendFollowUp();
    }
}

// Add selected text to follow-up question
function addSelectionToFollowUp() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
        const chatInput = document.getElementById('chatInput');
        const currentValue = chatInput.value.trim();

        // Add selected text with quotes and context
        const quotedText = `"${selectedText}"`;

        if (currentValue) {
            chatInput.value = currentValue + ' ' + quotedText + ' ';
        } else {
            chatInput.value = quotedText + ' - ';
        }

        // Focus the input and position cursor at the end
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);

        // Clear the selection
        selection.removeAllRanges();

        // Show a brief visual feedback
        const feedback = document.createElement('div');
        feedback.textContent = 'Added to follow-up question!';
        feedback.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--accent); color: white; padding: 8px 16px; border-radius: 4px; z-index: 9999; font-size: 14px;';
        document.body.appendChild(feedback);
        setTimeout(() => document.body.removeChild(feedback), 1500);
    }
}

function addChatMessage(message, sender) {
    const chatHistory = document.getElementById('chatHistory');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    messageDiv.textContent = message;

    // Make assistant messages selectable for follow-up questions
    if (sender === 'assistant') {
        messageDiv.style.userSelect = 'text';
        messageDiv.style.cursor = 'text';
        messageDiv.title = 'Select text to add to follow-up question';
    }

    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Handle text selection for follow-up questions
document.addEventListener('mouseup', function (event) {
    // Small delay to ensure selection is fully processed
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText && selectedText.length > 3) { // Minimum 3 characters
            // Check if selection is within response areas
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const container = range.commonAncestorContainer;
                const parentElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

                // Check if selection is in response content or chat messages
                const isInResponse = parentElement.closest('#responseContent') ||
                    parentElement.closest('.chat-message.assistant');

                if (isInResponse) {
                    // Show button positioned relative to selection
                    showAddToFollowUpButton(selectedText);
                }
          
            }
        } else {
            // Remove button if no meaningful selection
            const existingBtn = document.getElementById('addToFollowUpBtn');
            if (existingBtn) existingBtn.remove();
        }
    }, 10);
});

// Handle keyboard shortcut (Ctrl+Enter) to add selection
document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.key === 'Enter') {
        addSelectionToFollowUp();
    }
});

function showAddToFollowUpButton(selectedText) {
    // Remove any existing button
    const existingBtn = document.getElementById('addToFollowUpBtn');
    if (existingBtn) existingBtn.remove();

    // Get selection position
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Create floating button positioned relative to selection
    const btn = document.createElement('button');
    btn.id = 'addToFollowUpBtn';
    btn.innerHTML = '+ Add to Question';
    btn.style.cssText = `
                    position: fixed;
                    top: ${rect.bottom + 5}px;
                    left: ${rect.left + (rect.width / 2) - 60}px;
                    background: var(--accent);
                    color: white;
                    border: none;
                    padding: 6px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    z-index: 9999;
                    font-size: 11px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    white-space: nowrap;
                `;

    btn.onclick = function () {
        addSelectionToFollowUp();
        btn.remove();
    };

    document.body.appendChild(btn);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (btn.parentNode) btn.remove();
    }, 4000);
}

// Listen for messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'showLoading':
            showLoading();
            break;
        case 'showResponse':
            webviewRequestInProgress = false; // Clear request flag

            const responseArea = document.getElementById('responseArea');
            let responseTitle = document.getElementById('responseTitle');
            let responseContent = document.getElementById('responseContent');
            if (!responseTitle || !responseContent) {
                responseArea.innerHTML = '<h3 id="responseTitle"></h3><div id="responseContent"></div>';
                responseTitle = document.getElementById('responseTitle');
                responseContent = document.getElementById('responseContent');
            }
            responseTitle.textContent = message.levelTitle + ' Response';
            responseContent.textContent = message.response || '';
            responseContent.style.whiteSpace = 'pre-wrap';
            responseContent.style.userSelect = 'text';
            responseContent.style.cursor = 'text';
            responseContent.title = 'Select text to add to follow-up question';
            responseArea.classList.add('show');

            // Show chat interface
            document.getElementById('chatInterface').classList.add('show');

            // Unlock next level if available
            const levels = ['concept', 'how', 'code'];
            const currentIndex = levels.indexOf(message.level);
            if (currentIndex >= 0) {
                unlockNextLevel(currentIndex);
            }
            break;
        case 'markCompleted':
            // Grey out and disable the completed level button
            (function () {
                const id = message.level;
                const btn = document.getElementById('level-' + id);
                if (btn) {
                    btn.classList.add('disabled');
                    btn.onclick = null;
                    const statusSpan = btn.querySelector('.level-status');
                    if (statusSpan) {
                        statusSpan.textContent = 'DONE';
                        statusSpan.className = 'level-status completed';
                    }
                }
            })();
            break;
        case 'showFollowUpResponse':
            addChatMessage(message.response, 'assistant');
            break;
        case 'showError':
            webviewRequestInProgress = false; // Clear request flag on error too
            showError(message.message);
            break;
    }
});
window.toggleTheme = toggleTheme;
window.sendFollowUp = sendFollowUp;
window.handleChatKeyPress = handleChatKeyPress;