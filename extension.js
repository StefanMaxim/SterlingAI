const vscode = require('vscode');
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
  console.log('Sterling extension is now active!');

  const disposable = vscode.commands.registerCommand('learnsor.askQuestion', function() {
    console.log('Sterling command triggered!');
    
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
    'Sterling',
    'Sterling Learning Assistant',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(__dirname, 'media'))]
    }
  );

  panel.webview.html = getEnhancedInterfaceHtml(selectedText, question, panel.webview);

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
      case 'copyToFile':
        handleCopyToFile(message.text, editor, panel);
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
  
  // Check if request already in progress
  if (isRequestInFlight) {
    panel.webview.postMessage({
      command: 'showError',
      message: 'A request is already in progress. Please wait for it to complete.'
    });
    return;
  }
  
  // Level access and timing validation
  if (levelIndex > userProgress.currentLevel) {
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

  // All checks passed - proceed with request
  const language = getLanguageFromUri(editor.document.uri);
  
  panel.webview.postMessage({
    command: 'showLoading',
    level: requestedLevel
  });

  isRequestInFlight = true;
  
  generateEducationalResponse(selectedText, question, requestedLevel, language)
    .then(function(response) {
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

      panel.webview.postMessage({
        command: 'markCompleted',
        level: requestedLevel
      });
    })
    .catch(function(error) {
      panel.webview.postMessage({
        command: 'showError',
        message: error.message || 'Unknown error occurred'
      });
    })
    .finally(function() {
      isRequestInFlight = false;
    });
}

function handleFollowUpQuestion(followUpQuestion, selectedText, editor, panel) {
  console.log('Handling follow-up question:', followUpQuestion);
  
  const followUpPrompt = `This is a casual follow-up question, NOT a structured learning exercise.

User asked: "${followUpQuestion}"

Respond in plain text as if you're casually chatting with a friend. Give a brief, general answer (2-3 sentences) that's not tied to any specific project. End with a simple question if helpful.

ABSOLUTELY FORBIDDEN:
- Any structured formats (CONCEPT, WHY, HOW, etc.)
- Numbered lists or bullet points  
- Comment blocks or code formatting
- Reference to specific projects unless directly asked
- Educational lesson structure

This should read like a normal text message conversation. Be helpful but casual and general.`;

  console.log('Calling generateFollowUpResponse...');
  generateFollowUpResponse(followUpPrompt)
    .then(function(response) {
      console.log('Follow-up response received:', response);
      panel.webview.postMessage({
        command: 'showFollowUpResponse',
        response: response
      });
    })
    .catch(function(error) {
      console.error('Follow-up error:', error);
      panel.webview.postMessage({
        command: 'showError',
        message: error.message || 'Unknown error occurred'
      });
    });
}

function handleCopyToFile(textToCopy, editor, panel) {
  try {
    const language = getLanguageFromUri(editor.document.uri);
    const processedText = extractAndConvertCommentBlock(textToCopy, language);
    
    const position = editor.selection.active;
    
    editor.edit(editBuilder => {
      editBuilder.insert(position, processedText);
    }).then(success => {
      if (success) {
        panel.webview.postMessage({
          command: 'showCopySuccess',
          message: '✓ Comment block copied to file!'
        });
        vscode.window.showTextDocument(editor.document);
      } else {
        panel.webview.postMessage({
          command: 'showError',
          message: 'Failed to copy text to file'
        });
      }
    });
  } catch (error) {
    panel.webview.postMessage({
      command: 'showError',
      message: 'Error copying to file: ' + error.message
    });
  }
}

function extractAndConvertCommentBlock(text, targetLanguage) {
  let commentContent = '';
  
  // Look for various comment block patterns first
  const pythonBlockRegex = /"""([\s\S]*?)"""/g;
  const cStyleBlockRegex = /\/\*([\s\S]*?)\*\//g;
  
  let match = pythonBlockRegex.exec(text);
  if (match) {
    commentContent = match[1].trim();
  } else {
    match = cStyleBlockRegex.exec(text);
    if (match) {
      commentContent = match[1].trim();
    }
  }
  
  // If no comment block found, extract structured content more intelligently
  if (!commentContent) {
    const lines = text.split('\n');
    let structuredContent = [];
    let inStructuredSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check if this line starts a new concept/section
      if (trimmed.match(/^\d+\.\s*(CONCEPT|WHY|HOW|CODE):/i)) {
        inStructuredSection = true;
        structuredContent.push(line);
      }
      // If we're in a structured section, include continuation lines
      else if (inStructuredSection) {
        // Stop at explanatory text or empty lines followed by explanatory text
        if (trimmed.match(/^(These foundational|Would you like|For your|Note:|Want to explore)/i) ||
            (trimmed === '' && i + 1 < lines.length && 
             lines[i + 1].trim().match(/^(These foundational|Would you like|For your|Note:|Want to explore)/i))) {
          break;
        }
        // Include the line if it's indented content or related text
        if (trimmed !== '' || (structuredContent.length > 0 && structuredContent[structuredContent.length - 1].trim() !== '')) {
          structuredContent.push(line);
        }
      }
    }
    
    if (structuredContent.length > 0) {
      commentContent = structuredContent.join('\n').trim();
    } else {
      // Fallback: everything before explanatory text
      const beforeExplanation = text.split(/These foundational|Would you like|For your|Note:|Want to explore/i)[0];
      commentContent = beforeExplanation.trim();
    }
  }
  
  return convertToCommentSyntax(commentContent, targetLanguage);
}

function convertToCommentSyntax(content, targetLanguage) {
  const langLower = targetLanguage.toLowerCase();
  
  switch (langLower) {
    case 'python':
      return `\n"""\n${content}\n"""\n`;
    case 'javascript':
    case 'typescript':
    case 'java':
    case 'cpp':
    case 'c++':
    case 'c':
    case 'cs':
    case 'c#':
    case 'rust':
    case 'go':
    case 'php':
    case 'swift':
      return `\n/*\n${content}\n*/\n`;
    case 'ruby':
      return `\n=begin\n${content}\n=end\n`;
    case 'html':
      return `\n<!--\n${content}\n-->\n`;
    case 'css':
      return `\n/*\n${content}\n*/\n`;
    default:
      return `\n/*\n${content}\n*/\n`;
  }
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

function generateEducationalResponse(code, question, level, language) {
  return new Promise(function(resolve, reject) {
    const activeEditor = vscode.window.activeTextEditor;
    let workspaceRoot = null;
    
    const folders = vscode.workspace.workspaceFolders;
    
    if (folders && folders.length > 0) {
      for (const folder of folders) {
        if (folder.uri && folder.uri.fsPath) {
          const wsPath = folder.uri.fsPath;
          if (fs.existsSync(path.join(wsPath, 'api_client.py'))) {
            workspaceRoot = wsPath;
            break;
          }
        }
      }
    }
    
    if (!workspaceRoot && activeEditor && activeEditor.document && activeEditor.document.uri) {
      const filePath = activeEditor.document.uri.fsPath;
      let testDir = path.dirname(filePath);
      
      for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(testDir, 'api_client.py'))) {
          workspaceRoot = testDir;
          break;
        }
        const parentDir = path.dirname(testDir);
        if (parentDir === testDir) break;
        testDir = parentDir;
      }
    }
    
    if (!workspaceRoot) {
      const knownPaths = [
        'C:\\Users\\ericl\\LearnSor\\LearnSor',
        path.join(process.cwd(), 'LearnSor'),
        process.cwd()
      ];
      
      for (const testPath of knownPaths) {
        if (fs.existsSync(testPath) && fs.existsSync(path.join(testPath, 'api_client.py'))) {
          workspaceRoot = testPath;
          break;
        }
      }
    }
    
    // If still not found, perform a limited recursive search inside each workspace folder
    if (!workspaceRoot) {
      console.log('api_client.py not found in obvious locations, starting limited workspace search');
      try {
        const maxDepth = 4;
        const visited = new Set();

        function searchDir(dir, depth) {
          if (!dir || depth > maxDepth || visited.has(dir)) return null;
          visited.add(dir);
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }

          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isFile() && e.name === 'api_client.py') return dir;
            if (e.isDirectory()) {
              const found = searchDir(full, depth + 1);
              if (found) return found;
            }
          }
          return null;
        }

        if (folders && folders.length > 0) {
          for (const folder of folders) {
            try {
              const start = folder.uri && folder.uri.fsPath ? folder.uri.fsPath : null;
              if (!start) continue;
              const found = searchDir(start, 0);
              console.log('Searched workspace folder:', start, 'found:', !!found);
              if (found) { workspaceRoot = found; break; }
            } catch (e) {
              console.log('Error searching folder', folder, e && e.message);
            }
          }
        }
      } catch (e) {
        console.log('Error during recursive search for api_client.py:', e && e.message);
      }
    }

    if (!workspaceRoot) {
      // Build a list of candidate paths to check and log each check for diagnostics
      const candidates = [];
      try {
        // workspace folders
        if (folders && folders.length > 0) {
          for (const f of folders) if (f && f.uri && f.uri.fsPath) candidates.push(f.uri.fsPath);
        }

        // __dirname (extension install location)
        candidates.push(__dirname);

        // process cwd
        candidates.push(process.cwd());

        // active editor file's directory and upward parents
        if (activeEditor && activeEditor.document && activeEditor.document.uri) {
          let p = path.dirname(activeEditor.document.uri.fsPath);
          for (let i = 0; i < 6 && p; i++) {
            candidates.push(p);
            const parent = path.dirname(p);
            if (parent === p) break;
            p = parent;
          }
        }
      } catch (e) {
        console.log('Error building candidate list for api_client.py', e && e.message);
      }

      // De-duplicate and check candidates
      const uniq = Array.from(new Set(candidates.filter(Boolean)));
      console.log('api_client.py candidates to check:', uniq);

      for (const c of uniq) {
        try {
          const exists = fs.existsSync(path.join(c, 'api_client.py'));
          console.log('Checking', c, 'api_client.py exists=', exists);
          if (exists) { workspaceRoot = c; break; }
        } catch (e) {
          console.log('Error checking candidate', c, e && e.message);
        }
      }

      // If still not found, give a helpful diagnostic list in the error
      if (!workspaceRoot) {
        const tried = uniq.slice(0, 20).join(', ');
        return reject(new Error('Could not find api_client.py. Paths tried: ' + tried));
      }
    }

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
    
    try {
      const child = spawn(pythonCmd, ['-c', pySnippet], { cwd: workspaceRoot, env: process.env });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', function(data) { stdout += data.toString(); });
      child.stderr.on('data', function(data) { stderr += data.toString(); });
      
      child.on('close', function(code) {
        if (code !== 0) {
          return reject(new Error('Python exited with code ' + code + (stderr ? (': ' + stderr) : '')));
        }
        
        try {
          const parsed = JSON.parse(stdout || '{}');
          resolve(parsed.combined || parsed.level1 || 'No output');
        } catch (e) {
          reject(new Error('Failed to parse Python output: ' + e.message));
        }
      });
      
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
      
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
      
    } catch (e) {
      reject(new Error('Failed to start Python: ' + e.message));
    }
  });
}

function generateFollowUpResponse(prompt) {
  return new Promise(function(resolve, reject) {
    console.log('generateFollowUpResponse called with prompt length:', prompt.length);
    
    const activeEditor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders;
    let workspaceRoot = null;
    
    // Method 1: Check workspace folders for .env file
    if (folders && folders.length > 0) {
      for (const folder of folders) {
        if (folder.uri && folder.uri.fsPath) {
          const wsPath = folder.uri.fsPath;
          console.log('Checking workspace folder for .env:', wsPath);
          if (fs.existsSync(path.join(wsPath, '.env'))) {
            workspaceRoot = wsPath;
            console.log('Found .env at:', workspaceRoot);
            break;
          }
        }
      }
    }
    
    // Method 2: Use active editor file path and search up
    if (!workspaceRoot && activeEditor && activeEditor.document && activeEditor.document.uri) {
      const filePath = activeEditor.document.uri.fsPath;
      console.log('Active file path:', filePath);
      let testDir = path.dirname(filePath);
      
      // Search up the directory tree for .env file
      for (let i = 0; i < 10; i++) {
        console.log('Checking directory for .env:', testDir);
        if (fs.existsSync(path.join(testDir, '.env'))) {
          workspaceRoot = testDir;
          console.log('Found .env at:', workspaceRoot);
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
        path.join(process.cwd(), 'LearnSor')
      ];
      
      for (const testPath of knownPaths) {
        console.log('Checking known path for .env:', testPath);
        if (fs.existsSync(testPath) && fs.existsSync(path.join(testPath, '.env'))) {
          workspaceRoot = testPath;
          console.log('Found .env at known path:', workspaceRoot);
          break;
        }
      }
    }
    
    // Fallback
    if (!workspaceRoot) {
      workspaceRoot = process.cwd();
      console.log('Using fallback workspace:', workspaceRoot);
    }

    const pySnippet = `
import sys, json, os
from dotenv import load_dotenv
import anthropic

params = json.loads(sys.stdin.read())
proj = params.get("project_path", ".")
env_path = os.path.join(proj, ".env")

print(f"DEBUG: Looking for .env at: {env_path}", file=sys.stderr)
print(f"DEBUG: .env exists: {os.path.exists(env_path)}", file=sys.stderr)

if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
    print(f"DEBUG: Loaded .env from: {env_path}", file=sys.stderr)
else:
    load_dotenv()
    print("DEBUG: Used default .env loading", file=sys.stderr)

api_key = os.getenv("ANTHROPIC_API_KEY")
print(f"DEBUG: API key found: {bool(api_key)}", file=sys.stderr)

if not api_key:
    print(f"DEBUG: Current working directory: {os.getcwd()}", file=sys.stderr)
    print(f"DEBUG: Project path: {proj}", file=sys.stderr)
    print(f"DEBUG: Full env path: {os.path.abspath(env_path)}", file=sys.stderr)
    raise ValueError("ANTHROPIC_API_KEY not found in environment")

client = anthropic.Anthropic(api_key=api_key)
prompt = params.get("task", "")

response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=300,
    temperature=0.7,
    messages=[{"role": "user", "content": prompt}]
)

result = response.content[0].text
print(json.dumps({"response": result}))
`;

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log('Starting Python for follow-up with command:', pythonCmd);
    console.log('Working directory:', workspaceRoot);
    
    try {
      const child = spawn(pythonCmd, ['-c', pySnippet], { cwd: workspaceRoot, env: process.env });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', function(data) { stdout += data.toString(); });
      child.stderr.on('data', function(data) { stderr += data.toString(); });
      
      child.on('close', function(code) {
        console.log('Python follow-up process closed with code:', code);
        if (stderr) console.log('Python stderr:', stderr);
        if (stdout) console.log('Python stdout:', stdout);
        
        if (code !== 0) {
          return reject(new Error('Python exited with code ' + code + (stderr ? (': ' + stderr) : '')));
        }
        
        try {
          const parsed = JSON.parse(stdout || '{}');
          let response = parsed.response || 'No response';
          
          response = response.replace(/^\s*"""\s*/g, '').replace(/\s*"""\s*$/g, '');
          response = response.replace(/^\s*\/\*\s*/g, '').replace(/\s*\*\/\s*$/g, '');
          response = response.replace(/^\d+\.\s*CONCEPT:/gm, '');
          response = response.replace(/^\s*WHY:/gm, '');
          response = response.replace(/^\s*HOW:/gm, '');
          response = response.trim();
          
          resolve(response);
        } catch (e) {
          reject(new Error('Failed to parse Python output: ' + e.message));
        }
      });
      
      child.stdin.write(JSON.stringify({
        task: prompt,
        project_path: workspaceRoot
      }));
      child.stdin.end();
      
    } catch (e) {
      reject(new Error('Failed to start Python: ' + e.message));
    }
  });
}

function getEnhancedInterfaceHtml(selectedCode, question, webview) {
  const escapedCode = selectedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedQuestion = question.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const mediaPath = vscode.Uri.file(path.join(__dirname, 'media'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'webview.js'));
  const htmlPath = path.join(__dirname, 'media', 'interface.html');
  
  try {
    // Read the HTML template file
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    // Replace template variables
    return htmlContent
      .replace('{{STYLE_URI}}', styleUri.toString())
      .replace('{{SCRIPT_URI}}', scriptUri.toString())
      .replace('{{ESCAPED_QUESTION}}', escapedQuestion)
      .replace('{{ESCAPED_CODE}}', escapedCode);
  } catch (error) {
    console.error('Error reading interface.html:', error);
    // Fallback to a basic HTML structure
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>LearnSor - Error</title>
      </head>
      <body>
          <h1>Error loading interface</h1>
          <p>Could not load interface.html: ${error.message}</p>
    </body>
    </html>
  `;
}
}

module.exports = {
  activate: activate,
  deactivate: function() {}
};
