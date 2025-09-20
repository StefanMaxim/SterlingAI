from dotenv import load_dotenv
import os
import anthropic

load_dotenv()
api_key = os.getenv('ANTHROPIC_API_KEY')

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=api_key)

def detect_language_from_filename(filename):
    """Detect programming language from filename extension."""
    if not filename:
        return 'python'  # Default fallback

    extension = filename.lower().split('.')[-1]

    language_map = {
        'py': 'python',
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'cpp': 'cpp',
        'cc': 'cpp',
        'cxx': 'cpp',
        'c': 'c',
        'h': 'c',
        'hpp': 'cpp',
        'cs': 'csharp',
        'java': 'java',
        'kt': 'kotlin',
        'swift': 'swift',
        'go': 'go',
        'rs': 'rust',
        'php': 'php',
        'rb': 'ruby',
        'scala': 'scala',
        'sh': 'shell',
        'bash': 'shell',
        'zsh': 'shell'
    }

    return language_map.get(extension, 'python')  # Default to Python

def get_comment_block_syntax(language):
    """Get the comment block syntax for different programming languages."""
    block_syntax = {
        'python': ('"""', '"""'),      # Triple quotes
        'javascript': ('/*', '*/'),    # Multi-line comment
        'cpp': ('/*', '*/'),
        'c': ('/*', '*/'),
        'csharp': ('/*', '*/'),
        'java': ('/*', '*/'),
        'rust': ('/*', '*/'),
        'go': ('/*', '*/'),
        'php': ('/*', '*/'),
        'ruby': ('=begin', '=end'),    # Block comment
        'swift': ('/*', '*/'),
        'kotlin': ('/*', '*/'),
        'typescript': ('/*', '*/'),
        'scala': ('/*', '*/'),
        'shell': ('<< \'COMMENT\'', 'COMMENT')  # Heredoc style
    }
    return block_syntax.get(language.lower(), ('"""', '"""'))  # Default to Python

def generate_hints(user_code, task_description, programming_language=None, filename=None, additional_instructions=None):
    """
    Generate step-by-step hints for a coding task.

    Args:
        user_code (str): The user's current code
        task_description (str): Description of what they want to accomplish
        programming_language (str, optional): The programming language being used.
            If None, will be auto-detected from filename or default to python
        filename (str, optional): Filename for auto-detecting programming language
        additional_instructions (str, optional): Any additional context or constraints

    Returns:
        str: Step-by-step hints from Claude
    """
    # Auto-detect language if not provided
    if not programming_language and filename:
        programming_language = detect_language_from_filename(filename)
    elif not programming_language:
        programming_language = 'python'  # Safe default

    # Get comment block syntax for this language
    start_comment, end_comment = get_comment_block_syntax(programming_language)

    # Build the prompt
    prompt = f"""You are LearnSor, an AI tutor that helps people learn programming by providing hints instead of writing code for them.

Current user code:
{user_code}

Programming language: {programming_language}
Task: {task_description}

FIRST LEVEL HINTING - FOUNDATIONAL LEARNING:
Provide SHORT, CONCISE hints that focus on:
1. WHAT they should do next (high-level concept, no specific function names)
2. WHY this step is important for learning programming concepts
3. How it connects to their existing code structure

Use PURE PSEUDOCODE or NATURAL LANGUAGE descriptions - NO actual syntax or function names.
This is for learners who need to understand the concept before learning the specific syntax.

If additional instructions were provided, consider them: {additional_instructions or 'None'}

Format as a comment block using {start_comment} and {end_comment} with structured, numbered hints. Keep it under 10 lines total. Focus on learning, not implementation.

Example format:
{start_comment}
1. CONCEPT: What to do next
   WHY: Why this matters for learning
2. CONCEPT: Next step
   WHY: Learning importance
{end_comment}"""

    try:
        # Make API call to Claude
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1000,
            temperature=0.7,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        return response.content[0].text

    except Exception as e:
        return f"Error generating hints: {str(e)}"

# Example usage - Test with different scenarios
if __name__ == "__main__":
    print("LearnSor Hint Generation Examples")
    print("=" * 40)

    # Example 1: Python auto-detection with comment blocks
    print("\n1. Python Auto-Detection Test (Comment Blocks):")
    python_code = ""
    python_task = "Make simple tic tac toe game with basic logic"

    hints = generate_hints(python_code, python_task, filename="script.py")
    print(f"Task: {python_task}")
    print("Generated hints with Python comment blocks (\"\"\"...\"\"\"):")
    print(hints)

    # Example 2: C++ auto-detection with comment blocks
    print("\n2. C++ Auto-Detection Test (Comment Blocks):")
    cpp_code = "#include <iostream>\nint main() {\n    std::cout << \"Hello\" << std::endl;\n    return 0;\n}"
    cpp_task = "Add user input to get name and display greeting"

    cpp_hints = generate_hints(cpp_code, cpp_task, filename="main.cpp")
    print(f"Task: {cpp_task}")
    print("Generated hints with C++ comment blocks (/*...*/):")
    print(cpp_hints)

    # Example 3: JavaScript with comment blocks
    print("\n3. JavaScript Test (Comment Blocks):")
    js_code = "console.log('Hello World');"
    js_task = "Add user input functionality"

    js_hints = generate_hints(js_code, js_task, "javascript")
    print(f"Task: {js_task}")
    print("Generated hints with JavaScript comment blocks (/*...*/):")
    print(js_hints)

    print("\n" + "=" * 40)
    print("Examples completed! The system is ready for user input.")