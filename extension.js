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
      showLearningInterface(context, selectedText, question, editor);
    });
  });

  context.subscriptions.push(disposable);
}

function showLearningInterface(context, selectedText, question, editor) {
  console.log('Creating enhanced webview panel');
  const panel = vscode.window.createWebviewPanel(
    'learnsor',
    'LearnSor Learning Assistant',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );

  panel.webview.html = getEnhancedInterfaceHtml(
    panel.webview,
    context.extensionUri,
    selectedText, 
    question);

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
        process.cwd(),
        __dirname,
        path.join(__dirname, '..')
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
    
    // If still not found, try ascending from process.cwd() and __dirname for a few levels
    const searched = [];
    if (!workspaceRoot) {
      const rootsToTry = [];
      if (folders && folders.length > 0) rootsToTry.push(...folders.map(f => f.uri.fsPath));
      if (activeEditor && activeEditor.document && activeEditor.document.uri) rootsToTry.push(path.dirname(activeEditor.document.uri.fsPath));
      rootsToTry.push(process.cwd());
      rootsToTry.push(__dirname);

      for (const start of rootsToTry) {
        if (!start) continue;
        let testDir = start;
        for (let i = 0; i < 6; i++) {
          const candidate = path.join(testDir, 'api_client.py');
          searched.push(candidate);
          if (fs.existsSync(candidate)) {
            workspaceRoot = testDir;
            console.log('Found api_client.py at:', workspaceRoot);
            break;
          }
          const parent = path.dirname(testDir);
          if (!parent || parent === testDir) break;
          testDir = parent;
        }
        if (workspaceRoot) break;
      }
    }

    if (!workspaceRoot) {
      const folderPaths = (folders || []).map(f => f.uri && f.uri.fsPath).filter(Boolean);
      console.error('Failed to find api_client.py. Searched locations (examples):');
      console.error('- Workspace folders:', folderPaths);
      console.error('- Active file path:', activeEditor && activeEditor.document && activeEditor.document.uri && activeEditor.document.uri.fsPath);
      console.error('- Additional candidates tried:', searched.slice(0, 20));
      return reject(new Error('Could not find api_client.py. Make sure it exists in the workspace root (or in a parent directory). Searched these candidates: ' + JSON.stringify(searched.slice(0,20))));
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

function getEnhancedInterfaceHtml(webview, extensionUri, selectedCode, question) {
  const fs = require('fs');
  const vscode = require('vscode');

  const escapeHtml = (s='') =>
    String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const mediaRoot    = vscode.Uri.joinPath(extensionUri, 'media');
  const interfaceUri = vscode.Uri.joinPath(mediaRoot, 'interface.html');
  const styleUri     = vscode.Uri.joinPath(mediaRoot, 'style.css');
  const scriptUri    = vscode.Uri.joinPath(mediaRoot, 'ui.js');

  let html = fs.readFileSync(interfaceUri.fsPath, 'utf8');

  html = html
    .replaceAll('@@STYLE@@',  webview.asWebviewUri(styleUri).toString())
    .replaceAll('@@SCRIPT@@', webview.asWebviewUri(scriptUri).toString())
    .replaceAll('@@QUESTION@@', escapeHtml(question || ''))
    .replaceAll('@@CODE@@',     escapeHtml(selectedCode || ''));

  return html;
}


function deactivate() {}

module.exports = {
  activate: activate,
  deactivate: deactivate
};