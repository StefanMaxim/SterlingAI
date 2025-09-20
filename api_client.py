from dotenv import load_dotenv
import os
import anthropic
import glob

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

def analyze_project_context(project_path, max_files=10):
    """
    Analyze the project structure and extract relevant context.

    Args:
        project_path (str): Path to the project directory
        max_files (int): Maximum number of files to analyze for context

    Returns:
        str: Context information about the project
    """
    context_parts = []

    # Files to ignore (not relevant for context)
    ignore_files = {
        '.gitignore', '.env', '.env.local', '.env.production', '.env.development',
        'package-lock.json', 'yarn.lock', 'requirements.txt', 'Pipfile.lock',
        '.git', 'node_modules', '__pycache__', '.pytest_cache', '.coverage',
        'dist', 'build', '.next', '.nuxt', 'target', 'Cargo.lock',
        '.DS_Store', 'Thumbs.db', '.vscode', '.idea'
    }

    # Analyze project structure
    try:
        # Get all relevant source files
        source_files = []
        for ext in ['*.py', '*.js', '*.jsx', '*.ts', '*.tsx', '*.cpp', '*.cc', '*.cxx', '*.c', '*.h', '*.hpp', '*.cs', '*.java', '*.kt', '*.swift', '*.go', '*.rs', '*.php', '*.rb']:
            source_files.extend(glob.glob(os.path.join(project_path, '**', ext), recursive=True))

        # Filter out irrelevant files
        filtered_files = []
        for file_path in source_files:
            filename = os.path.basename(file_path)
            if filename not in ignore_files and not any(filename.endswith(ext) for ext in ['.log', '.tmp', '.cache']):
                filtered_files.append(file_path)

        # Limit the number of files to analyze
        source_files = filtered_files[:max_files]

        if source_files:
            context_parts.append(f"Project contains {len(source_files)} source files:")
            for file_path in source_files:
                rel_path = os.path.relpath(file_path, project_path)
                context_parts.append(f"  - {rel_path}")

                # Read a sample of the file content for context
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        # Get first few lines and any imports/declarations
                        lines = content.split('\n')[:10]
                        if lines:
                            context_parts.append(f"    Content preview: {lines[0]}")
                            # Look for imports or key declarations
                            for line in lines[1:5]:
                                if any(keyword in line.lower() for keyword in ['import', 'from', 'include', 'using', 'package']):
                                    context_parts.append(f"    {line.strip()}")
                except Exception:
                    pass
            context_parts.append("")
    except Exception as e:
        context_parts.append(f"Could not analyze project structure: {str(e)}")

    return "\n".join(context_parts)

def extract_relevant_context(user_code, project_context, task_description):
    """
    Extract the most relevant context for the user's current task.

    Args:
        user_code (str): The user's current code
        project_context (str): Information about the project
        task_description (str): What the user wants to accomplish

    Returns:
        str: Relevant context for generating hints
    """
    context_parts = []

    # Add project context if available
    if project_context.strip():
        context_parts.append("PROJECT CONTEXT:")
        context_parts.append(project_context)
        context_parts.append("")

    # Add current code context
    if user_code.strip():
        context_parts.append("CURRENT CODE:")
        context_parts.append(user_code)
        context_parts.append("")

    # Add task context
    context_parts.append("TASK:")
    context_parts.append(task_description)

    return "\n".join(context_parts)

def generate_hints(user_code, task_description, programming_language=None, filename=None, project_path=None, additional_instructions=None):
    """
    Generate step-by-step hints for a coding task with full project context.

    Args:
        user_code (str): The user's current code
        task_description (str): Description of what they want to accomplish
        programming_language (str, optional): The programming language being used.
            If None, will be auto-detected from filename or default to python
        filename (str, optional): Filename for auto-detecting programming language
        project_path (str, optional): Path to project directory for context analysis
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

    # Analyze project context if provided
    project_context = ""
    if project_path:
        project_context = analyze_project_context(project_path)

    # Extract relevant context
    full_context = extract_relevant_context(user_code, project_context, task_description)

    # Build the prompt with full context awareness
    prompt = f"""You are LearnSor, an AI tutor that helps people learn programming by providing hints instead of writing code for them.

CONTEXT ANALYSIS:
{full_context}

Programming language: {programming_language}

FIRST LEVEL HINTING - FOUNDATIONAL LEARNING:
Based on the provided context (project structure, existing code, and user task), provide SHORT, CONCISE hints that focus on:
1. WHAT they should do next (high-level concept, no specific function names)
2. WHY this step is important for learning programming concepts
3. How it connects to their existing project structure and codebase

Use PURE PSEUDOCODE or NATURAL LANGUAGE descriptions - NO actual syntax or function names.
This is for learners who need to understand the concept before learning the specific syntax.

Consider the project structure and existing code when suggesting next steps. If the user's task is vague, infer the most logical next steps based on the codebase context.

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

    except anthropic.APIError as e:
        return f"API Error: {str(e)}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"

def generate_level2_hints(level1_response, programming_language, user_code="", task_description=""):
    """
    Generate HOW implementation hints for existing concepts.

    Args:
        level1_response (str): The complete Level 1 response (CONCEPT and WHY hints)
        programming_language (str): The programming language being used
        user_code (str, optional): The user's current code for context
        task_description (str, optional): Original task description for context

    Returns:
        str: HOW implementation hints to add to existing concepts
    """
    # Get comment block syntax for this language
    start_comment, end_comment = get_comment_block_syntax(programming_language)

    # Build the prompt for HOW hints only with full context
    prompt = f"""You are LearnSor, an AI tutor that helps people learn programming by providing hints instead of writing code for them.

CONTEXT FROM LEVEL 1:
The user has already received these foundational hints:
{level1_response}

Programming language: {programming_language}
Original task: {task_description}
User's current code: {user_code}

SECOND LEVEL HINTING - HOW IMPLEMENTATION HINTS ONLY:
Based on the Level 1 hints the user already received, generate ONLY the HOW sections that provide:
1. Conceptual guidance toward implementation (not specific code)
2. Questions to help them think through the solution
3. Hints about data structures or patterns to consider
4. Learning-focused suggestions, not direct answers

IMPORTANT: 
- The user has already seen the CONCEPT and WHY sections above
- Generate ONLY the HOW implementation hints
- Match the numbering from Level 1 hints
- Guide them to discover the solution themselves
- Provide general examples or conceptual patterns
- Avoid giving exact code for their specific task

Format as numbered HOW hints only, matching the numbered concepts from level 1:

Example output format:
{start_comment}
1. HOW: Consider what data structure would best represent a grid. Think about accessing positions. For example, nested lists could work.

2. HOW: Think about alternating between players. Could a boolean or counter help track turns?

3. HOW: What makes a move invalid? Check boundaries first, then availability.
{end_comment}"""

    try:
        # Make API call to Claude
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1500,
            temperature=0.6,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        return response.content[0].text

    except anthropic.APIError as e:
        return f"API Error: {str(e)}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"
    
def generate_level3_hints(level1_response, level2_response, programming_language, user_code="", task_description=""):
    """
    Generate Level 3 hints with code snippets in a fill-in-the-blank format.

    Args:
        level1_response (str): The complete Level 1 response (CONCEPT and WHY hints)
        level2_response (str): The HOW implementation hints
        programming_language (str): The programming language being used
        user_code (str, optional): The user's current code for context
        task_description (str, optional): Original task description for context

    Returns:
        str: Level 3 hints with CONCEPT, WHY, HOW, and code snippets
    """
    # Get comment block syntax for this language
    start_comment, end_comment = get_comment_block_syntax(programming_language)

    # Build the prompt for Level 3 hints with code snippets
    prompt = f"""You are LearnSor, an AI tutor that helps people learn programming by providing hints instead of writing code for them.

CONTEXT FROM PREVIOUS LEVELS:
The user has already received these foundational hints:
Level 1 (CONCEPT and WHY):
{level1_response}

Level 2 (HOW):
{level2_response}

Programming language: {programming_language}
Original task: {task_description}
User's current code: {user_code}

THIRD LEVEL HINTING - CODE SNIPPETS IN FILL-IN-THE-BLANK FORMAT:
Based on the Level 1 and Level 2 hints the user already received, generate code snippets in a fill-in-the-blank format that:
1. Provide partial code with placeholders like <var>, <func>, <condition>, etc.
2. Are specific to the user's task and context
3. Help the user understand the structure and logic without giving complete answers
4. Include comments explaining what each placeholder represents

IMPORTANT:
- The user has already seen the CONCEPT, WHY, and HOW sections
- Provide code snippets with placeholders, not complete solutions
- Use comments to explain placeholders and guide the user
- Ensure the snippets align with the user's task and programming language

Format as numbered sections matching the Level 1 and Level 2 hints:

Example output format:
{start_comment}
1. CODE SNIPPET:
# Define a function to check if a move is valid
def <func_name>(<param1>, <param2>):
    if <condition>:
        return True
    return False
# <func_name>: Name of the function (e.g., is_valid_move)
# <param1>, <param2>: Parameters for the function (e.g., row, column)
# <condition>: Logic to check validity (e.g., within bounds, not occupied)

2. CODE SNIPPET:
# Create a loop to alternate between players
while <condition>:
    print("Player <player_num>'s turn")
    <action>
# <condition>: Loop condition (e.g., game not over)
# <player_num>: Variable for the current player
# <action>: Code for the player's move
{end_comment}"""

    try:
        # Make API call to Claude
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2000,
            temperature=0.5,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        return response.content[0].text

    except anthropic.APIError as e:
        return f"API Error: {str(e)}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"

def parse_and_enhance_hints(level1_hints, level2_hints):
    """
    Parse level 1 hints and enhance them with level 2 HOW information.

    Args:
        level1_hints (str): Original CONCEPT and WHY hints
        level2_hints (str): HOW implementation hints to add

    Returns:
        str: Enhanced hints with CONCEPT, WHY, and HOW sections
    """
    # Extract the content from comment blocks
    level1_content = level1_hints.strip()
    level2_content = level2_hints.strip()

    # Remove comment block markers from both
    for marker in ['"""', '/*', '*/', '=begin', '=end', '<< \'COMMENT\'', 'COMMENT']:
        level1_content = level1_content.replace(marker, '').strip()
        level2_content = level2_content.replace(marker, '').strip()

    # Split into lines and process
    level1_lines = level1_content.split('\n')
    level2_lines = level2_content.split('\n')

    # Parse level 2 HOW hints into a dictionary
    how_hints = {}
    current_number = None
    current_how_content = []
    
    for line in level2_lines:
        line = line.strip()
        if line and line[0].isdigit() and 'HOW:' in line:
            # Save previous HOW content if any
            if current_number and current_how_content:
                how_hints[current_number] = ' '.join(current_how_content)
            
            # Extract number and start new HOW content
            current_number = line.split('.')[0].strip()
            how_content = line.split('HOW:', 1)[1].strip()
            current_how_content = [how_content] if how_content else []
        elif current_number and line and not line.startswith(('"""', '/*', '*/', '=begin', '=end')):
            # Continue multi-line HOW content
            current_how_content.append(line)
    
    # Save the last HOW content
    if current_number and current_how_content:
        how_hints[current_number] = ' '.join(current_how_content)

    # Build enhanced hints
    enhanced_lines = []
    current_concept = None
    
    for line in level1_lines:
        line_stripped = line.strip()
        
        # Skip comment block markers
        if line_stripped in ['"""', '/*', '*/', '=begin', '=end']:
            enhanced_lines.append(line)
            continue
            
        # Check if this is a numbered concept line
        if line_stripped and line_stripped[0].isdigit() and 'CONCEPT:' in line_stripped:
            current_concept = line_stripped.split('.')[0].strip()
            enhanced_lines.append(line)
        elif line_stripped and 'WHY:' in line_stripped:
            enhanced_lines.append(line)
            # Add corresponding HOW hint if available
            if current_concept and current_concept in how_hints:
                # Match the indentation of the WHY line
                indent = len(line) - len(line.lstrip())
                how_line = ' ' * indent + f"HOW: {how_hints[current_concept]}"
                enhanced_lines.append(how_line)
        else:
            enhanced_lines.append(line)

    return '\n'.join(enhanced_lines)




# Example usage - Test with different scenarios
if __name__ == "__main__":
    print("LearnSor Hint Generation Examples")
    print("=" * 40)

    # Example 1: Level 1 vs Level 2 Hinting Progression
    print("\n1. HINT PROGRESSION: Level 1 → Level 2 (with full context)")
    python_code = ""
    python_task = "Make simple tic tac toe game with basic logic"

    # Level 1: Get conceptual hints with project context
    print("\n📚 LEVEL 1 - Conceptual Learning (with project context):")
    level1_hints = generate_hints(python_code, python_task, project_path=".", filename="script.py")
    print("Generated conceptual hints:")
    print(level1_hints)

    # Level 2: Get implementation details with Level 1 context
    print("\n🔧 LEVEL 2 - Implementation Details (with Level 1 context):")
    level2_hints = generate_level2_hints(level1_hints, "python", python_code, python_task)
    print("Generated HOW hints only:")
    print(level2_hints)

    # Combined: Parse and enhance
    print("\n🎯 COMBINED - Enhanced Hints:")
    enhanced_hints = parse_and_enhance_hints(level1_hints, level2_hints)
    print("Final enhanced hints with CONCEPT + WHY + HOW:")
    print(enhanced_hints)

    # Example 2: C++ Implementation
    print("\n\n2. C++ IMPLEMENTATION EXAMPLE:")
    cpp_code = "#include <iostream>\nint main() {\n    std::cout << \"Hello\" << std::endl;\n    return 0;\n}"
    cpp_task = "Add user input to get name and display greeting"

    print(f"Task: {cpp_task}")
    cpp_level1 = generate_hints(cpp_code, cpp_task, programming_language="cpp", filename="main.cpp")
    cpp_level2 = generate_level2_hints(cpp_level1, "cpp", cpp_code, cpp_task)
    cpp_enhanced = parse_and_enhance_hints(cpp_level1, cpp_level2)
    print("C++ Enhanced hints:")
    print(cpp_enhanced)

    print("\n" + "=" * 40)
    print("Examples completed! The system is ready for user input.")