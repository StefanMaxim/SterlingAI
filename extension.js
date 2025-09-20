const vscode = require('vscode');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const LEARNING_LEVELS = [
  { id: 'logical', title: '🧠 Logical Steps', description: 'Walk through the thinking process' },
  { id: 'pseudocode', title: '📝 Pseudo-code', description: 'Show the algorithm structure' },
  { id: 'functions', title: '🔧 Functions & Methods', description: 'Specific functions to use' },
  { id: 'snippet', title: '💾 Code Snippet', description: 'Working code example' }
];

// Track user progress and timing
let userProgress = {
  currentLevel: 0,
  levelTimestamps: {},
  selectedCode: '',
  currentQuestion: ''
};

function activate(context) {
  console.log('LearnSor extension is now active!');

  const disposable = vscode.commands.registerCommand('learnsor.askQuestion', function() {
    console.log('LearnSor command triggered!');
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      console.log('No active editor found');
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    
    if (!selectedText) {
      console.log('No text selected');
      vscode.window.showErrorMessage('Please select some code first');
      return;
    }

    // Reset progress for new code selection
    if (selectedText !== userProgress.selectedCode) {
      userProgress = {
        currentLevel: 0,
        levelTimestamps: {},
        selectedCode: selectedText,
        currentQuestion: ''
      };
    }

    vscode.window.showInputBox({
      prompt: 'What would you like to learn about the selected code?',
      placeHolder: 'e.g., "How do I implement error handling here?"'
    }).then(function(question) {
      if (!question) return;

      userProgress.currentQuestion = question;
      showLearningInterface(selectedText, question, editor);
    });
  });

  context.subscriptions.push(disposable);
}

function showLearningInterface(selectedText, question, editor) {
  console.log('Creating enhanced webview panel');
  const panel = vscode.window.createWebviewPanel(
    'learnsor',
    'LearnSor Learning Assistant',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.webview.html = getEnhancedInterfaceHtml(selectedText, question);

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(function(message) {
    console.log('Received message:', message);
    
    switch (message.command) {
      case 'requestLevel':
        handleLevelRequest(message.level, selectedText, question, editor, panel);
        break;
      case 'askFollowUp':
        handleFollowUpQuestion(message.question, selectedText, editor, panel);
        break;
      case 'toggleTheme':
        // Theme toggle handled in webview
        break;
    }
  });
}

function handleLevelRequest(requestedLevel, selectedText, question, editor, panel) {
  console.log('Handling level request for:', requestedLevel);
  const levelIndex = LEARNING_LEVELS.findIndex(l => l.id === requestedLevel);
  const currentTime = Date.now();
  
  // Check if user can access this level
  if (levelIndex > userProgress.currentLevel) {
    // Check if they've waited long enough
    const lastLevelTime = userProgress.levelTimestamps[userProgress.currentLevel];
    if (lastLevelTime && (currentTime - lastLevelTime) < 60000) {
      const waitTime = Math.ceil((60000 - (currentTime - lastLevelTime)) / 1000);
      panel.webview.postMessage({
        command: 'showError',
        message: `Please wait ${waitTime} more seconds before accessing the next level. Learn progressively! 🎓`
      });
      return;
    }
  }

  // Allow access and generate response
  const language = getLanguageFromUri(editor.document.uri);
  console.log('Sending loading message to webview');
  
  panel.webview.postMessage({
    command: 'showLoading',
    level: requestedLevel
  });

  console.log('Calling generateEducationalResponse...');
  generateEducationalResponse(selectedText, question, requestedLevel, language)
    .then(function(response) {
      console.log('Got response, sending to webview');
      // Update progress
      if (levelIndex >= userProgress.currentLevel) {
        userProgress.currentLevel = levelIndex;
        userProgress.levelTimestamps[levelIndex] = currentTime;
      }

      panel.webview.postMessage({
        command: 'showResponse',
        level: requestedLevel,
        levelTitle: LEARNING_LEVELS[levelIndex].title,
        response: response,
        canProceed: levelIndex < LEARNING_LEVELS.length - 1
      });
    })
    .catch(function(error) {
      console.log('Error in generateEducationalResponse:', error);
      panel.webview.postMessage({
        command: 'showError',
        message: error.message || 'Unknown error occurred'
      });
    });
}

function handleFollowUpQuestion(followUpQuestion, selectedText, editor, panel) {
  const language = getLanguageFromUri(editor.document.uri);
  const currentLevelId = LEARNING_LEVELS[userProgress.currentLevel].id;
  
  panel.webview.postMessage({
    command: 'showLoading',
    level: 'followup'
  });

  generateEducationalResponse(selectedText, followUpQuestion, currentLevelId, language)
    .then(function(response) {
      panel.webview.postMessage({
        command: 'showFollowUpResponse',
        response: response
      });
    })
    .catch(function(error) {
      panel.webview.postMessage({
        command: 'showError',
        message: error.message || 'Unknown error occurred'
      });
    });
}

function generateEducationalResponse(code, question, level, language) {
  // Route through Python api_client to use the 3-level system
  return new Promise(function(resolve, reject) {
    const workspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : __dirname;

    const activeEditor = vscode.window.activeTextEditor;
    const filename = activeEditor ? path.basename(activeEditor.document.fileName) : undefined;

    const pySnippet = [
      'import sys, json',
      'from api_client import generate_all_hints',
      'params = json.loads(sys.stdin.read())',
      'res = generate_all_hints(params.get("code", ""), params.get("task", ""), filename=params.get("filename"), project_path=params.get("project_path", "."))',
      'print(json.dumps(res))'
    ].join('; ');

    const child = spawn('python', ['-c', pySnippet], { cwd: workspaceRoot });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', function(data) { stdout += data.toString(); });
    child.stderr.on('data', function(data) { stderr += data.toString(); });

    child.on('error', function(err) {
      reject(new Error('Failed to start Python: ' + err.message));
    });

    child.on('close', function(codeExit) {
      if (codeExit !== 0) {
        return reject(new Error('Python exited with code ' + codeExit + (stderr ? (': ' + stderr) : '')));
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        switch (level) {
          case 'logical':
          case 'pseudocode':
            resolve(parsed.level1 || parsed.combined || 'No Level 1 output');
            break;
          case 'functions':
            resolve(parsed.level2 || 'No Level 2 output');
            break;
          case 'snippet':
            resolve(parsed.level3 || 'No Level 3 output');
            break;
          default:
            resolve(parsed.combined || parsed.level1 || 'No output');
        }
      } catch (e) {
        reject(new Error('Failed to parse Python output: ' + e.message + (stdout ? (' | OUT: ' + stdout) : '')));
      }
    });

    // Send params to Python via stdin
    const payload = {
      code: code,
      task: question,
      filename: filename,
      project_path: workspaceRoot
    };
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function getLanguageFromUri(uri) {
  const parts = uri.fsPath.split('.');
  const ext = parts[parts.length - 1];
  if (!ext) return 'code';
  
  const extLower = ext.toLowerCase();
  const langMap = {
    'js': 'JavaScript', 'ts': 'TypeScript', 'py': 'Python',
    'java': 'Java', 'cpp': 'C++', 'cs': 'C#', 'c': 'C',
    'html': 'HTML', 'css': 'CSS', 'php': 'PHP', 'rb': 'Ruby'
  };
  return langMap[extLower] || 'code';
}

function getEnhancedInterfaceHtml(selectedCode, question) {
  const escapedCode = selectedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedQuestion = question.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LearnSor Learning Assistant</title>
        <style>
            :root {
                --bg-primary: #ffffff;
                --bg-secondary: #f8f9fa;
                --bg-tertiary: #e9ecef;
                --text-primary: #212529;
                --text-secondary: #495057;
                --text-muted: #6c757d;
                --border: #dee2e6;
                --accent: #007ACC;
                --accent-hover: #005a9e;
                --success: #28a745;
                --warning: #ffc107;
                --error: #dc3545;
                --code-bg: #2d2d2d;
                --code-text: #f8f8f2;
            }
            
            [data-theme="dark"] {
                --bg-primary: #1e1e1e;
                --bg-secondary: #252526;
                --bg-tertiary: #2d2d30;
                --text-primary: #cccccc;
                --text-secondary: #c9c9c9;
                --text-muted: #969696;
                --border: #3e3e42;
                --accent: #4fc3f7;
                --accent-hover: #29b6f6;
                --code-bg: #1e1e1e;
                --code-text: #d4d4d4;
            }

            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: var(--bg-primary);
                color: var(--text-primary);
                line-height: 1.6;
                transition: all 0.3s ease;
            }
            
            .container {
                max-width: 900px;
                margin: 0 auto;
                padding: 20px;
                min-height: 100vh;
            }
            
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 0;
                border-bottom: 2px solid var(--accent);
                margin-bottom: 20px;
            }
            
            .theme-toggle {
                background: var(--accent);
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s ease;
            }
            
            .theme-toggle:hover {
                background: var(--accent-hover);
                transform: translateY(-1px);
            }
            
            .question-section {
                background: var(--bg-secondary);
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 24px;
                border: 1px solid var(--border);
            }
            
            .code-block {
                background: var(--code-bg);
                color: var(--code-text);
                padding: 16px;
                border-radius: 8px;
                font-family: 'Courier New', Monaco, monospace;
                font-size: 14px;
                margin: 12px 0;
                overflow-x: auto;
                border: 1px solid var(--border);
            }
            
            .learning-levels {
                display: grid;
                gap: 16px;
                margin-bottom: 24px;
            }
            
            .level-button {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: var(--bg-secondary);
                border: 2px solid var(--border);
                border-radius: 12px;
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
            }
            
            .level-button:hover:not(.disabled) {
                border-color: var(--accent);
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 122, 204, 0.15);
            }
            
            .level-button.active {
                border-color: var(--accent);
                background: var(--accent);
                color: white;
            }
            
            .level-button.disabled {
                opacity: 0.5;
                cursor: not-allowed;
                background: var(--bg-tertiary);
            }
            
            .level-info {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .level-status {
                font-size: 12px;
                padding: 4px 8px;
                border-radius: 12px;
                font-weight: bold;
            }
            
            .level-status.locked {
                background: var(--warning);
                color: white;
            }
            
            .level-status.available {
                background: var(--success);
                color: white;
            }
            
            .level-status.completed {
                background: var(--accent);
                color: white;
            }
            
            .response-area {
                background: var(--bg-secondary);
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
                border-left: 4px solid var(--accent);
                display: none;
            }
            
            .response-area.show {
                display: block;
                animation: slideIn 0.3s ease;
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .chat-interface {
                margin-top: 24px;
                background: var(--bg-tertiary);
                border-radius: 12px;
                padding: 16px;
                display: none;
            }
            
            .chat-interface.show {
                display: block;
            }
            
            .chat-history {
                max-height: 300px;
                overflow-y: auto;
                margin-bottom: 16px;
                padding: 12px;
                background: var(--bg-primary);
                border-radius: 8px;
                border: 1px solid var(--border);
            }
            
            .chat-message {
                padding: 8px 12px;
                margin: 8px 0;
                border-radius: 8px;
            }
            
            .chat-message.user {
                background: var(--accent);
                color: white;
                margin-left: 20%;
            }
            
            .chat-message.assistant {
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                margin-right: 20%;
            }
            
            .chat-input-container {
                display: flex;
                gap: 8px;
            }
            
            .chat-input {
                flex: 1;
                padding: 12px;
                border: 2px solid var(--border);
                border-radius: 8px;
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 14px;
            }
            
            .chat-input:focus {
                outline: none;
                border-color: var(--accent);
            }
            
            .chat-send {
                padding: 12px 20px;
                background: var(--accent);
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s ease;
            }
            
            .chat-send:hover {
                background: var(--accent-hover);
            }
            
            .loading {
                text-align: center;
                padding: 40px;
                color: var(--text-muted);
            }
            
            .spinner {
                display: inline-block;
                animation: spin 1s linear infinite;
                font-size: 24px;
                margin-bottom: 12px;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .error-message {
                background: var(--error);
                color: white;
                padding: 16px;
                border-radius: 8px;
                margin: 16px 0;
                display: none;
            }
            
            .error-message.show {
                display: block;
                animation: slideIn 0.3s ease;
            }
        </style>
    </head>
    <body data-theme="light">
        <div class="container">
            <div class="header">
                <h1>🎓 LearnSor Learning Assistant</h1>
                <button class="theme-toggle" onclick="toggleTheme()">🌙 Dark Mode</button>
            </div>
            
            <div class="question-section">
                <h3>Your Question:</h3>
                <p><em>"${escapedQuestion}"</em></p>
                <h4>Selected Code:</h4>
                <div class="code-block">${escapedCode}</div>
            </div>
            
            <div class="error-message" id="errorMessage"></div>
            
            <div class="learning-levels">
                <div class="level-button available" onclick="requestLevel('logical', 0)">
                    <div class="level-info">
                        <span>🧠 Logical Steps</span>
                        <small>Walk through the thinking process</small>
                    </div>
                    <span class="level-status available">START HERE</span>
                </div>
                
                <div class="level-button disabled" id="level-pseudocode">
                    <div class="level-info">
                        <span>📝 Pseudo-code</span>
                        <small>Show the algorithm structure</small>
                    </div>
                    <span class="level-status locked">LOCKED</span>
                </div>
                
                <div class="level-button disabled" id="level-functions">
                    <div class="level-info">
                        <span>🔧 Functions & Methods</span>
                        <small>Specific functions to use</small>
                    </div>
                    <span class="level-status locked">LOCKED</span>
                </div>
                
                <div class="level-button disabled" id="level-snippet">
                    <div class="level-info">
                        <span>💾 Code Snippet</span>
                        <small>Working code example</small>
                    </div>
                    <span class="level-status locked">LOCKED</span>
                </div>
            </div>
            
            <div class="response-area" id="responseArea">
                <h3 id="responseTitle">Response</h3>
                <div id="responseContent"></div>
            </div>
            
            <div class="chat-interface" id="chatInterface">
                <h4>💬 Ask Follow-up Questions</h4>
                <div class="chat-history" id="chatHistory"></div>
                <div class="chat-input-container">
                    <input type="text" class="chat-input" id="chatInput" placeholder="Ask a follow-up question..." onkeypress="handleChatKeyPress(event)">
                    <button class="chat-send" onclick="sendFollowUp()">Send</button>
                </div>
            </div>
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            let currentTheme = 'light';
            let levelTimers = {};
            
            function toggleTheme() {
                currentTheme = currentTheme === 'light' ? 'dark' : 'light';
                document.body.setAttribute('data-theme', currentTheme);
                document.querySelector('.theme-toggle').textContent = currentTheme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
                vscode.postMessage({command: 'toggleTheme', theme: currentTheme});
            }
            
            function requestLevel(levelId, index) {
                console.log('Requesting level:', levelId);
                const button = document.querySelector(\`[onclick="requestLevel('\${levelId}', \${index})"]\`) || document.getElementById(\`level-\${levelId}\`);
                if (button && button.classList.contains('disabled')) return;
                
                showLoading();
                vscode.postMessage({command: 'requestLevel', level: levelId});
                
                // Fallback timeout in case message doesn't come back
                setTimeout(() => {
                    const responseArea = document.getElementById('responseArea');
                    if (responseArea.innerHTML.includes('LearnSor is thinking')) {
                        showError('Request timed out. Please try again or check your API key.');
                    }
                }, 30000);
            }
            
            function showLoading() {
                const responseArea = document.getElementById('responseArea');
                responseArea.innerHTML = '<div class="loading"><div class="spinner">🤔</div><h3>LearnSor is thinking...</h3><p>Generating your personalized learning response</p></div>';
                responseArea.classList.add('show');
            }
            
            function showError(message) {
                const errorDiv = document.getElementById('errorMessage');
                errorDiv.textContent = message;
                errorDiv.classList.add('show');
                setTimeout(() => errorDiv.classList.remove('show'), 5000);
            }
            
            function unlockNextLevel(currentIndex) {
                const levels = ['logical', 'pseudocode', 'functions', 'snippet'];
                if (currentIndex < levels.length - 1) {
                    const nextLevel = levels[currentIndex + 1];
                    const nextButton = document.getElementById(\`level-\${nextLevel}\`);
                    if (nextButton) {
                        // Start 1-minute timer
                        setTimeout(() => {
                            nextButton.classList.remove('disabled');
                            nextButton.onclick = () => requestLevel(nextLevel, currentIndex + 1);
                            const statusSpan = nextButton.querySelector('.level-status');
                            statusSpan.textContent = 'AVAILABLE';
                            statusSpan.className = 'level-status available';
                        }, 60000); // 60 seconds
                        
                        // Show countdown
                        const statusSpan = nextButton.querySelector('.level-status');
                        let countdown = 60;
                        const timer = setInterval(() => {
                            statusSpan.textContent = \`WAIT \${countdown}s\`;
                            countdown--;
                            if (countdown < 0) {
                                clearInterval(timer);
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
                
                vscode.postMessage({command: 'askFollowUp', question: question});
            }
            
            function handleChatKeyPress(event) {
                if (event.key === 'Enter') {
                    sendFollowUp();
                }
            }
            
            function addChatMessage(message, sender) {
                const chatHistory = document.getElementById('chatHistory');
                const messageDiv = document.createElement('div');
                messageDiv.className = \`chat-message \${sender}\`;
                messageDiv.textContent = message;
                chatHistory.appendChild(messageDiv);
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
            
            // Listen for messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'showLoading':
                        showLoading();
                        break;
                    case 'showResponse':
                        const responseArea = document.getElementById('responseArea');
                        const responseTitle = document.getElementById('responseTitle');
                        const responseContent = document.getElementById('responseContent');
                        
                        responseTitle.textContent = message.levelTitle + ' Response';
                        responseContent.innerHTML = message.response.replace(/\\n/g, '<br>');
                        responseArea.classList.add('show');
                        
                        // Show chat interface
                        document.getElementById('chatInterface').classList.add('show');
                        
                        // Unlock next level if available
                        const levels = ['logical', 'pseudocode', 'functions', 'snippet'];
                        const currentIndex = levels.indexOf(message.level);
                        if (currentIndex >= 0) {
                            unlockNextLevel(currentIndex);
                        }
                        break;
                    case 'showFollowUpResponse':
                        addChatMessage(message.response, 'assistant');
                        break;
                    case 'showError':
                        showError(message.message);
                        break;
                }
            });
        </script>
    </body>
    </html>
  `;
}

function deactivate() {}

module.exports = {
  activate: activate,
  deactivate: deactivate
};