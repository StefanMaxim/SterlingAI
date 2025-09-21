const vscode = require('vscode');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const LEARNING_LEVELS = [
  { id: 'concept', title: '🧠 Concept & Why', description: 'High-level steps and reasoning (Level 1)' },
  { id: 'how', title: '🔧 How (Implementation Hints)', description: 'Guided implementation ideas (Level 2)' },
  { id: 'code', title: '💾 Code (with blanks)', description: 'Concrete code lines with blanks (Level 3)' }
];

// Track user progress and timing
let userProgress = {
  currentLevel: 0,
  levelTimestamps: {},
  selectedCode: '',
  currentQuestion: ''
};

// Prevent duplicate concurrent requests
let isRequestInFlight = false;

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
  
  // First check: Is a request already in progress?
  if (isRequestInFlight) {
    console.log('Request blocked: already in progress');
    panel.webview.postMessage({
      command: 'showError',
      message: 'A request is already in progress. Please wait for it to complete.'
    });
    // Clear any loading state
    panel.webview.postMessage({
      command: 'showResponse',
      level: requestedLevel,
      levelTitle: 'Request Blocked',
      response: 'A request is already in progress. Please wait for it to complete.',
      canProceed: false
    });
    return;
  }
  
  // Second check: Level access and timing validation
  if (levelIndex > userProgress.currentLevel) {
    const lastLevelTime = userProgress.levelTimestamps[userProgress.currentLevel];
    if (lastLevelTime && (currentTime - lastLevelTime) < 60000) {
      const waitTime = Math.ceil((60000 - (currentTime - lastLevelTime)) / 1000);
      console.log(`Request blocked: must wait ${waitTime} more seconds`);
      panel.webview.postMessage({
        command: 'showError',
        message: `Please wait ${waitTime} more seconds before accessing the next level. Learn progressively! 🎓`
      });
      // Clear any loading state that might have been set
      panel.webview.postMessage({
        command: 'showResponse',
        level: requestedLevel,
        levelTitle: 'Request Blocked',
        response: `Please wait ${waitTime} more seconds before accessing the next level.`,
        canProceed: false
      });
      return;
    }
  }

  // Third check: Can user access current level? (allow re-requests of completed levels)
  if (levelIndex < userProgress.currentLevel) {
    // Allow re-accessing previous levels
    console.log('Allowing re-access to previous level:', requestedLevel);
  } else if (levelIndex === userProgress.currentLevel) {
    // Allow current level
    console.log('Allowing access to current level:', requestedLevel);
  } else if (levelIndex === userProgress.currentLevel + 1) {
    // Allow next level (timing already checked above)
    console.log('Allowing access to next level:', requestedLevel);
  } else {
    // Block access to levels too far ahead
    console.log('Request blocked: level too far ahead');
    panel.webview.postMessage({
      command: 'showError',
      message: 'Please complete the previous levels first.'
    });
    // Clear any loading state
    panel.webview.postMessage({
      command: 'showResponse',
      level: requestedLevel,
      levelTitle: 'Request Blocked',
      response: 'Please complete the previous levels first.',
      canProceed: false
    });
    return;
  }

  // All checks passed - proceed with request
  const language = getLanguageFromUri(editor.document.uri);
  console.log('All checks passed, sending loading message to webview');
  
  panel.webview.postMessage({
    command: 'showLoading',
    level: requestedLevel
  });

  console.log('Calling generateEducationalResponse...');
  
  // Set request in flight AFTER loading message but BEFORE the async call
  isRequestInFlight = true;
  
  generateEducationalResponse(selectedText, question, requestedLevel, language)
    .then(function(response) {
      console.log('Got response, sending to webview');
      // Update progress only if this is a new or current level
      if (levelIndex >= userProgress.currentLevel) {
        userProgress.currentLevel = levelIndex;
        userProgress.levelTimestamps[levelIndex] = currentTime;
        console.log('Updated progress to level:', levelIndex);
      }

      panel.webview.postMessage({
        command: 'showResponse',
        level: requestedLevel,
        levelTitle: LEARNING_LEVELS[levelIndex].title,
        response: response,
        canProceed: levelIndex < LEARNING_LEVELS.length - 1
      });

      // Visually mark the completed level as done and disable it
      try {
        const levelIds = ['concept', 'how', 'code'];
        const completedId = levelIds[levelIndex];
        panel.webview.postMessage({
          command: 'markCompleted',
          level: completedId
        });
      } catch (e) {
        console.error('Error marking level completed:', e);
      }
    })
    .catch(function(error) {
      console.log('Error in generateEducationalResponse:', error);
      panel.webview.postMessage({
        command: 'showError',
        message: error.message || 'Unknown error occurred'
      });
      // Clear loading state on error
      panel.webview.postMessage({
        command: 'showResponse',
        level: requestedLevel,
        levelTitle: 'Error',
        response: 'Request failed. Please try again.',
        canProceed: false
      });
    })
    .finally(function() {
      // Always clear the request flag
      isRequestInFlight = false;
      console.log('Request completed, cleared isRequestInFlight flag');
    });
}

function handleFollowUpQuestion(followUpQuestion, selectedText, editor, panel) {
  const language = getLanguageFromUri(editor.document.uri);
  const currentLevelId = LEARNING_LEVELS[userProgress.currentLevel].id;
  
  panel.webview.postMessage({
    command: 'showLoading',
    level: 'followup'
  });

  // Add instruction for shorter responses to follow-up questions
  const enhancedQuestion = `${followUpQuestion}\n\n[Keep response short and focused - 3-4 sentences maximum]`;

  generateEducationalResponse(selectedText, enhancedQuestion, currentLevelId, language)
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
    const activeEditor = vscode.window.activeTextEditor;
    let workspaceRoot = null;
    
    // Try multiple methods to find the workspace root
    const folders = vscode.workspace.workspaceFolders;
    
    // Method 1: Use workspace folders
    if (folders && folders.length > 0) {
      for (const folder of folders) {
        if (folder.uri && folder.uri.fsPath) {
          const wsPath = folder.uri.fsPath;
          console.log('Checking workspace folder:', wsPath);
          if (fs.existsSync(path.join(wsPath, 'api_client.py'))) {
            workspaceRoot = wsPath;
            console.log('Found api_client.py in workspace folder:', workspaceRoot);
            break;
          }
        }
      }
    }
    
    // Method 2: Use active editor file path
    if (!workspaceRoot && activeEditor && activeEditor.document && activeEditor.document.uri) {
      const filePath = activeEditor.document.uri.fsPath;
      console.log('Active file path:', filePath);
      let testDir = path.dirname(filePath);
      
      // Search up the directory tree
      for (let i = 0; i < 10; i++) {
        console.log('Checking directory:', testDir);
        if (fs.existsSync(path.join(testDir, 'api_client.py'))) {
          workspaceRoot = testDir;
          console.log('Found api_client.py at:', workspaceRoot);
          break;
        }
        const parentDir = path.dirname(testDir);
        if (parentDir === testDir) break; // reached root
        testDir = parentDir;
      }
    }
    
    // Method 3: Direct hardcoded check for known location
    if (!workspaceRoot) {
      const knownPaths = [
        'C:\\Users\\ericl\\LearnSor\\LearnSor',
        path.join(process.cwd(), 'LearnSor'),
        process.cwd()
      ];
      
      for (const testPath of knownPaths) {
        console.log('Checking known path:', testPath);
        if (fs.existsSync(testPath) && fs.existsSync(path.join(testPath, 'api_client.py'))) {
          workspaceRoot = testPath;
          console.log('Found api_client.py at known path:', workspaceRoot);
          break;
        }
      }
    }
    
    if (!workspaceRoot) {
      console.error('Failed to find api_client.py. Searched:');
      console.error('- Workspace folders:', folders?.map(f => f.uri?.fsPath));
      console.error('- Active file path:', activeEditor?.document?.uri?.fsPath);
      return reject(new Error('Could not find api_client.py. Make sure it exists in the workspace root.'));
    }
    
    console.log('Using workspace root:', workspaceRoot);

    const filename = (activeEditor && activeEditor.document && activeEditor.document.fileName)
      ? path.basename(activeEditor.document.fileName)
      : undefined;
    const activeFilePath = (activeEditor && activeEditor.document && activeEditor.document.fileName)
      ? activeEditor.document.fileName
      : undefined;

    const pySnippet = [
      'import sys, json, os, importlib.util',
      'params = json.loads(sys.stdin.read())',
      'proj = params.get("project_path", ".")',
      'api_path = os.path.join(proj, "api_client.py")',
      'spec = importlib.util.spec_from_file_location("api_client", api_path)',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'res = mod.generate_hints_for_level(params.get("code", ""), params.get("task", ""), filename=params.get("filename"), project_path=proj, target_level=params.get("target_level", "level1"), active_file_path=params.get("active_file_path"))',
      'print(json.dumps(res))'
    ].join('; ');

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    let child = null;
    let killedByTimeout = false;

    function attachHandlers(proc) {
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', function(data) { stdout += data.toString(); });
      proc.stderr.on('data', function(data) { stderr += data.toString(); });

      const KILL_MS = 45000;
      const killTimer = setTimeout(function() {
        killedByTimeout = true;
        try { proc.kill(); } catch (e) {}
      }, KILL_MS);

      proc.on('error', function(err) {
        clearTimeout(killTimer);
        // Fallback to 'py -3' on Windows if python not found
        if (process.platform === 'win32' && err.code === 'ENOENT') {
          try {
            const fallback = spawn('py', ['-3', '-c', pySnippet], { cwd: workspaceRoot || process.cwd(), env: process.env });
            attachHandlers(fallback);
            // resend payload on fallback
            fallback.stdin.write(JSON.stringify({
              code: code,
              task: question,
              filename: filename,
              project_path: workspaceRoot,
              active_file_path: activeFilePath,
              target_level: (function(){
                switch (level) {
                  case 'concept': return 'level1';
                  case 'how': return 'level2';
                  case 'code': return 'level3';
                  default: return 'level1';
                }
              })()
            }));
            fallback.stdin.end();
            return;
          } catch (e2) {
            return reject(new Error('Failed to start Python (fallback): ' + e2.message));
          }
        }
        reject(new Error('Failed to start Python: ' + err.message));
      });

      proc.on('close', function(codeExit) {
        clearTimeout(killTimer);
        if (killedByTimeout) {
          return reject(new Error('Python timed out after 45s'));
        }
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
          reject(new Error('Failed to parse Python output: ' + e.message + (stdout ? (' | OUT: ' + stdout) : '') + (stderr ? (' | ERR: ' + stderr) : '')));
        }
      });

      // Send params to Python via stdin
      const payload = {
        code: code,
        task: question,
        filename: filename,
        project_path: workspaceRoot,
        active_file_path: activeFilePath,
        target_level: (function(){
          switch (level) {
            case 'concept': return 'level1';
            case 'how': return 'level2';
            case 'code': return 'level3';
            default: return 'level1';
          }
        })()
      };
      try {
        proc.stdin.write(JSON.stringify(payload));
        proc.stdin.end();
      } catch (e) {
        reject(new Error('Failed to write to Python stdin: ' + e.message));
      }
    }

    try {
      child = spawn(pythonCmd, ['-c', pySnippet], { cwd: workspaceRoot || process.cwd(), env: process.env });
      attachHandlers(child);
    } catch (e) {
      // Fallback immediate attempt
      if (process.platform === 'win32') {
        try {
          child = spawn('py', ['-3', '-c', pySnippet], { cwd: workspaceRoot || process.cwd(), env: process.env });
          attachHandlers(child);
        } catch (e2) {
          reject(new Error('Failed to start Python: ' + e2.message));
        }
        } else {
        reject(new Error('Failed to start Python: ' + e.message));
      }
        }
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
            
            .level-status[title] {
                cursor: help;
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
                <div class="level-button available" id="level-concept" role="button" tabindex="0">
                    <div class="level-info">
                        <span>🧠 Concept & Why</span>
                        <small>High-level steps and reasoning</small>
                    </div>
                    <span class="level-status available">START HERE</span>
                </div>
                
                <div class="level-button disabled" id="level-how" role="button" tabindex="0">
                    <div class="level-info">
                        <span>🔧 How (Implementation Hints)</span>
                        <small>Guided implementation ideas</small>
                    </div>
                    <span class="level-status locked" title="Complete the previous level first">LOCKED</span>
                </div>
                
                <div class="level-button disabled" id="level-code" role="button" tabindex="0">
                    <div class="level-info">
                        <span>💾 Code (with blanks)</span>
                        <small>Concrete code lines with blanks</small>
                    </div>
                    <span class="level-status locked" title="Complete the previous level first">LOCKED</span>
                </div>
            </div>
            
            <div class="response-area" id="responseArea">
                <h3 id="responseTitle">Response</h3>
                <div id="responseContent"></div>
            </div>
            
            <div class="chat-interface" id="chatInterface">
                <h4>💬 Ask Follow-up Questions</h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                    💡 <strong>Tip:</strong> Highlight any part of the response above and click "+ Add to Question" or press Ctrl+Enter to reference it in your follow-up question.
                </p>
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
                    const stillLoading = el && el.textContent && el.textContent.includes('LearnSor is thinking');
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
                    responseContent.innerHTML = '<div class="loading"><div class="spinner">🤔</div><h3>LearnSor is thinking...</h3><p>Generating your personalized learning response</p></div>';
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
                    const nextButton = document.getElementById(\`level-\${nextLevel}\`);
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
                                statusSpan.textContent = \`WAIT \${countdown}s\`;
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
                
                vscode.postMessage({command: 'askFollowUp', question: question});
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
                    const quotedText = \`"\${selectedText}"\`;
                    
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
                messageDiv.className = \`chat-message \${sender}\`;
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
            document.addEventListener('mouseup', function(event) {
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
            document.addEventListener('keydown', function(event) {
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
                btn.style.cssText = \`
                    position: fixed;
                    top: \${rect.bottom + 5}px;
                    left: \${rect.left + (rect.width / 2) - 60}px;
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
                \`;
                
                btn.onclick = function() {
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
                        (function(){
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