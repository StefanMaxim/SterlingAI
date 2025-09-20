const vscode = require('vscode');
const axios = require('axios');

const LEARNING_LEVELS = [
  { id: 'logical', title: '🧠 Logical Steps', description: 'Walk through the thinking process' },
  { id: 'pseudocode', title: '📝 Pseudo-code', description: 'Show the algorithm structure' },
  { id: 'functions', title: '🔧 Functions & Methods', description: 'Specific functions to use' },
  { id: 'snippet', title: '💾 Code Snippet', description: 'Working code example' }
];

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
    console.log('Editor found');

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    console.log('Selected text:', selectedText);
    
    if (!selectedText) {
      console.log('No text selected');
      vscode.window.showErrorMessage('Please select some code first');
      return;
    }

    console.log('About to show quick pick');
    const items = LEARNING_LEVELS.map(function(level) {
      return {
        label: level.title,
        description: level.description,
        level: level.id
      };
    });

    vscode.window.showQuickPick(items, {
      placeHolder: 'How would you like to learn about this code?'
    }).then(function(chosen) {
      console.log('User chose:', chosen);
      if (!chosen) return;

      vscode.window.showInputBox({
        prompt: 'What would you like to learn about the selected code?',
        placeHolder: 'e.g., "How do I implement error handling here?"'
      }).then(function(question) {
        console.log('User question:', question);
        if (!question) return;

        console.log('Creating webview panel');
        const panel = vscode.window.createWebviewPanel(
          'learnsor',
          'LearnSor Learning Assistant',
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        );

        panel.webview.html = getLoadingHtml();

        const language = getLanguageFromUri(editor.document.uri);
        console.log('Language detected:', language);
        
        console.log('Calling Claude API...');
        generateEducationalResponse(selectedText, question, chosen.level, language)
          .then(function(response) {
            panel.webview.html = getResponseHtml(response, selectedText, question, chosen.label);
          })
          .catch(function(error) {
            console.log('Error occurred:', error);
            panel.webview.html = getErrorHtml(error.message || 'Unknown error');
          });
      });
    });
  });

  context.subscriptions.push(disposable);
}

function generateEducationalResponse(code, question, level, language) {
  return new Promise(function(resolve, reject) {
    const apiKey = vscode.workspace.getConfiguration('learnsor').get('apiKey');
    
    if (!apiKey) {
      reject(new Error('Please set your Claude API key in settings (learnsor.apiKey)'));
      return;
    }

    const prompts = {
      logical: 'You are an experienced CS teacher. A student has selected this ' + language + ' code and asked: "' + question + '"\n\nCode:\n```' + language + '\n' + code + '\n```\n\nExplain the logical thinking process step-by-step. Focus on the problem-solving approach, not specific syntax. Help them understand WHY each step is needed. Do not provide actual code.',

      pseudocode: 'A student needs pseudocode help for this ' + language + ' code. Their question: "' + question + '"\n\nCode:\n```' + language + '\n' + code + '\n```\n\nProvide clear pseudocode that shows the algorithm structure. Use simple English with basic programming constructs (if/then, loop, etc.). No actual code syntax.',

      functions: 'A student wants to know what functions/methods to use for this ' + language + ' code. Their question: "' + question + '"\n\nCode:\n```' + language + '\n' + code + '\n```\n\nList the key functions, methods, or APIs they should research and use. Explain what each does and why it is useful for their problem. Include where to find documentation.',

      snippet: 'Provide a short, educational code snippet for this ' + language + ' code. Student question: "' + question + '"\n\nOriginal code:\n```' + language + '\n' + code + '\n```\n\nGive a minimal working example with clear comments explaining each important line. Keep it concise but educational.'
    };

    const requestData = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompts[level]
        }
      ]
    };

    const config = {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    axios.post('https://api.anthropic.com/v1/messages', requestData, config)
      .then(function(response) {
        console.log('API Response:', response.data);
        resolve(response.data.content[0].text);
      })
      .catch(function(error) {
        console.log('API Error details:', error.response ? error.response.data : error.message);
        if (error.response) {
          const errorMsg = error.response.data.error ? error.response.data.error.message : 'Unknown API error';
          reject(new Error('API Error: ' + errorMsg + ' (Status: ' + error.response.status + ')'));
        } else {
          reject(new Error('Network Error: ' + error.message));
        }
      });
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

function getLoadingHtml() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>LearnSor</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }.loading { text-align: center; padding: 40px; }.spinner { animation: spin 1s linear infinite; display: inline-block; }@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style></head><body><div class="loading"><div class="spinner">🤔</div><h3>LearnSor is thinking...</h3><p>Generating your personalized learning response</p></div></body></html>';
}

function getResponseHtml(response, code, question, level) {
  const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedQuestion = question.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedResponse = response.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>LearnSor Response</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; line-height: 1.6; max-width: 800px; }.header { border-bottom: 2px solid #007ACC; padding-bottom: 10px; margin-bottom: 20px; }.question { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }.code-block { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 8px; font-family: "Courier New", monospace; margin: 10px 0; }.response { background: white; border-left: 4px solid #007ACC; padding: 20px; margin: 20px 0; }.level-badge { background: #007ACC; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.8em; }pre { white-space: pre-wrap; word-wrap: break-word; }</style></head><body><div class="header"><h2>🎓 LearnSor Learning Assistant</h2><span class="level-badge">' + level + '</span></div><div class="question"><h3>Your Question:</h3><p><em>"' + escapedQuestion + '"</em></p><h4>Selected Code:</h4><div class="code-block"><pre>' + escapedCode + '</pre></div></div><div class="response"><h3>Learning Response:</h3><div>' + escapedResponse + '</div></div></body></html>';
}

function getErrorHtml(error) {
  const escapedError = error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LearnSor Error</title><style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }.error { background: #ffe6e6; border: 1px solid #ffcccc; padding: 20px; border-radius: 8px; }</style></head><body><div class="error"><h3>❌ Oops! Something went wrong</h3><p>' + escapedError + '</p><p><strong>Setup help:</strong> Make sure to set your Claude API key in VS Code settings under "learnsor.apiKey"</p></div></body></html>';
}

function deactivate() {}

module.exports = {
  activate: activate,
  deactivate: deactivate
};