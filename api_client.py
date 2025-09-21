from dotenv import load_dotenv
import os
import anthropic
import glob
import re

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

def summarize_active_file(active_file_path: str) -> str:
    """Summarize the active file: imports, top-level defs/classes, globals/constants, TODO/FIXME."""
    if not active_file_path or not os.path.isfile(active_file_path):
        return ""

    try:
        with open(active_file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return ""

    lines = content.splitlines()
    imports: list[str] = []
    top_level_defs: list[str] = []
    globals_consts: list[str] = []
    todos: list[str] = []

    # Simple helpers
    def is_top_level(line: str) -> bool:
        return len(line) > 0 and (line[0] != ' ' and line[0] != '\t')

    for idx, line in enumerate(lines):
        stripped = line.strip()
        lower = stripped.lower()

        # Imports/packages/includes/usings
        if (lower.startswith('import ') or lower.startswith('from ') or lower.startswith('package ') or
                '#include' in stripped or lower.startswith('using ')):
            imports.append(stripped)

        # TODO / FIXME anywhere
        if 'todo' in lower or 'fixme' in lower:
            todos.append(f"L{idx+1}: {stripped}")

        # Top-level defs/classes (naive patterns)
        if is_top_level(line):
            # Python
            if re.match(r"^(def|class)\s+\w+", stripped):
                top_level_defs.append(stripped)
            # JS/TS
            elif re.match(r"^(export\s+)?(async\s+)?function\s+\w+\s*\(", stripped):
                top_level_defs.append(stripped)
            elif re.match(r"^(export\s+)?class\s+\w+", stripped):
                top_level_defs.append(stripped)
            elif re.match(r"^(const|let|var)\s+\w+\s*=\s*\(.*\)\s*=>", stripped):
                top_level_defs.append(stripped)
            # Java
            elif re.match(r"^(public|private|protected|abstract|final|static)\s+(class|interface|enum)\s+\w+", stripped):
                top_level_defs.append(stripped)
            elif re.match(r"^(public|private|protected|static|final|synchronized|native|abstract)\s+[\w\<\>\[\]\.,\s]+\s+\w+\s*\([^;]*\)\s*\{?", stripped):
                top_level_defs.append(stripped)
            # C/C++/C# (very naive function/class)
            elif re.match(r"^(class|struct)\s+\w+", stripped):
                top_level_defs.append(stripped)
            elif re.match(r"^[\w:\*<&>\s]+\s+\w+\s*\([^;]*\)\s*\{?\s*$", stripped):
                top_level_defs.append(stripped)

            # Globals/constants (ALL_CAPS or obvious const patterns)
            if re.match(r"^[A-Z0-9_]+\s*=", stripped):
                globals_consts.append(stripped)
            elif re.match(r"^(const|static\s+final)\s+", stripped):
                globals_consts.append(stripped)

    parts: list[str] = []
    parts.append(f"FILE: {os.path.basename(active_file_path)}")
    if imports:
        parts.append("IMPORTS:")
        parts.extend(f"  - {imp}" for imp in imports[:50])
    if top_level_defs:
        parts.append("TOP-LEVEL DEFINITIONS:")
        parts.extend(f"  - {d}" for d in top_level_defs[:100])
    if globals_consts:
        parts.append("GLOBALS/CONSTS:")
        parts.extend(f"  - {g}" for g in globals_consts[:50])
    if todos:
        parts.append("TODO/FIXME:")
        parts.extend(f"  - {t}" for t in todos[:50])

    return "\n".join(parts)

def extract_relevant_context(user_code, project_context, task_description, active_summary: str | None = None):
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

    # Add active file summary first if available
    if active_summary and active_summary.strip():
        context_parts.append("ACTIVE FILE SUMMARY:")
        context_parts.append(active_summary)
        context_parts.append("")

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

def generate_hints(user_code, task_description, programming_language=None, filename=None, project_path=None, additional_instructions=None, active_file_path: str | None = None):
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

    # Active file summary (if provided)
    active_summary = summarize_active_file(active_file_path) if active_file_path else ""

    # Extract relevant context
    full_context = extract_relevant_context(user_code, project_context, task_description, active_summary)

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
    
def generate_level3_hints(level2_response, programming_language, user_code="", task_description=""):
    """
    Generate LEVEL 3 hints: actual code lines with fill-in-the-blank sections.
    Each numbered hint begins with 'CODE:' and shows valid syntax containing blanks.

    Args:
        level2_response (str): The HOW hints from Level 2
        programming_language (str): The programming language being used
        user_code (str, optional): The user's current code for context
        task_description (str, optional): Original task description

    Returns:
        str: Numbered CODE hints with blanks inside actual syntax
    """
    # Get comment block syntax
    start_comment, end_comment = get_comment_block_syntax(programming_language)

    # Build the prompt
    prompt = f"""You are LearnSor, an AI tutor that helps people learn programming.

CONTEXT FROM LEVEL 2:
The user has already received these HOW hints:
{level2_response}

Programming language: {programming_language}
Original task: {task_description}
User's current code: {user_code}

THIRD LEVEL HINTING - CODE WITH BLANKS:
- Each hint must start with "<number>. CODE:"
- Provide real {programming_language} syntax (not pseudocode, not descriptions).
- Insert blanks using descriptive bracketed placeholders like [INSERT FUNCTION_NAME], [INSERT PARAMETER], [INSERT CONDITION], [INSERT INDEX], [INSERT PLAYER_SYMBOL], etc.
- Make placeholders clear about what the user should insert, e.g., [INSERT ERROR_MESSAGE], [INSERT PROMPT_TEXT].
- The code should be as close as possible to the final working solution, but incomplete in small places.
- After each CODE block, add an EXPLANATION section with 2-3 short lines describing what the code does and how to fill placeholders.

Example output format:
{start_comment}
1. CODE: print("[INSERT GREETING_MESSAGE]")
EXPLANATION:
- Prints a greeting to the console.
- Replace [INSERT GREETING_MESSAGE] with the text you want to show.

2. CODE: def [INSERT FUNCTION_NAME]([INSERT PARAMETER_NAME]): print("Hello, " + [INSERT PARAMETER_NAME])
EXPLANATION:
- Defines a function and uses the parameter in a message.
- Replace [INSERT FUNCTION_NAME] and [INSERT PARAMETER_NAME] with meaningful names.
{end_comment}"""

    try:
        # Make API call to Claude
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1200,
            temperature=0.5,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        return response.content[0].text

    except anthropic.APIError as e:
        return f"API Error: {str(e)}"
    except (FileNotFoundError, PermissionError, UnicodeDecodeError) as e:
        return f"File error: {str(e)}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"

def parse_and_enhance_hints(level1_hints, level2_hints, level3_hints):
    """
    Parse level 1 hints and enhance them with level 2 HOW and level 3 CODE information.

    Args:
        level1_hints (str): Original CONCEPT and WHY hints
        level2_hints (str): HOW implementation hints to add
        level3_hints (str): CODE snippets with blanks to add

    Returns:
        str: Enhanced hints with CONCEPT, WHY, HOW, and CODE sections
    """
    # Extract the content from comment blocks
    level1_content = level1_hints.strip()
    level2_content = level2_hints.strip()
    level3_content = level3_hints.strip()

    # Remove comment block markers from both
    for marker in ['"""', '/*', '*/', '=begin', '=end', '<< \'COMMENT\'', 'COMMENT']:
        level1_content = level1_content.replace(marker, '').strip()
        level2_content = level2_content.replace(marker, '').strip()
        level3_content = level3_content.replace(marker, '').strip()

    # Split into lines and process
    level1_lines = level1_content.split('\n')
    level2_lines = level2_content.split('\n')
    level3_lines = level3_content.split('\n')

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

    # Parse level 3 CODE hints into a dictionary
    code_hints = {}
    current_number = None
    current_code_lines = []

    for line in level3_lines:
        line_stripped = line.strip()
        if line_stripped and line_stripped[0].isdigit() and 'CODE:' in line_stripped:
            # Save previous code block
            if current_number and current_code_lines:
                code_hints[current_number] = '\n'.join(current_code_lines).strip()

            # Start new code block
            current_number = line_stripped.split('.')[0].strip()
            code_part = line.split('CODE:', 1)[1].strip()
            current_code_lines = [code_part] if code_part else []
        elif current_number:
            # Continue current code block (preserve original line format)
            current_code_lines.append(line)

    if current_number and current_code_lines:
        code_hints[current_number] = '\n'.join(current_code_lines).strip()

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
            # Add corresponding CODE hint if available
            if current_concept and current_concept in code_hints:
                indent = len(line) - len(line.lstrip())
                code_block = code_hints[current_concept].split('\n')
                if code_block:
                    enhanced_lines.append(' ' * indent + f"CODE: {code_block[0]}")
                    for extra_line in code_block[1:]:
                        enhanced_lines.append(' ' * indent + extra_line)
        else:
            enhanced_lines.append(line)

    return '\n'.join(enhanced_lines)



# Partial generation wrapper: compute only up to requested level
def generate_hints_for_level(user_code, task_description, filename=None, project_path=".", programming_language=None, additional_instructions=None, target_level="level1", active_file_path: str | None = None):
    """
    Generate hints up to a target level to minimize unnecessary API calls.

    target_level: one of 'level1', 'level2', 'level3', or mapped inputs
                  like 'logical'/'pseudocode' -> level1, 'functions' -> level2, 'snippet' -> level3
    """
    level_map = {
        'logical': 'level1',
        'pseudocode': 'level1',
        'functions': 'level2',
        'snippet': 'level3',
        'level1': 'level1',
        'level2': 'level2',
        'level3': 'level3',
    }
    target = level_map.get(str(target_level).lower(), 'level1')

    # Determine language
    lang = programming_language or (detect_language_from_filename(filename) if filename else 'python')

    # Compute only what is needed
    l1 = generate_hints(user_code, task_description, programming_language=lang, filename=filename, project_path=project_path, additional_instructions=additional_instructions, active_file_path=active_file_path)

    l2 = ""
    l3 = ""
    if target in ("level2", "level3"):
        l2 = generate_level2_hints(l1, lang, user_code, task_description)
    if target == "level3":
        l3 = generate_level3_hints(l2, lang, user_code, task_description)

    # Build combined view using available levels only
    if target == 'level1':
        combined = l1
    elif target == 'level2':
        combined = parse_and_enhance_hints(l1, l2, "")
    else:
        combined = parse_and_enhance_hints(l1, l2, l3)

    return {"level1": l1, "level2": l2, "level3": l3, "combined": combined}


__all__ = [
    "generate_hints",
    "generate_level2_hints",
    "generate_level3_hints",
    "parse_and_enhance_hints",
    "detect_language_from_filename",
    "generate_all_hints",
    "generate_hints_for_level",
]

def generate_all_hints(user_code, task_description, filename=None, project_path=".", programming_language=None, additional_instructions=None):
    lang = programming_language or (detect_language_from_filename(filename) if filename else "python")
    l1 = generate_hints(user_code, task_description, programming_language=lang, filename=filename, project_path=project_path, additional_instructions=additional_instructions)
    l2 = generate_level2_hints(l1, lang, user_code, task_description)
    l3 = generate_level3_hints(l2, lang, user_code, task_description)
    combined = parse_and_enhance_hints(l1, l2, l3)
    return {"level1": l1, "level2": l2, "level3": l3, "combined": combined}

"""
GUI Usage:
    from api_client import generate_all_hints

    result = generate_all_hints(user_code, task, filename="main.cpp", project_path=".")
    render_text = result["combined"]
"""
# Example usage - Test with different scenarios
if __name__ == "__main__":
    print("LearnSor Hint Generation Examples")
    print("=" * 40)

    # Example 1: Level 1 → Level 2 → Level 3 Hinting Progression
    print("\n1. HINT PROGRESSION: Level 1 → Level 2 → Level 3 (with full context)")
    python_code = ""
    python_task = "Make simple tic tac toe game with basic logic"

    # Level 1: Get conceptual hints with project context
    print("\n📚 LEVEL 1 - Conceptual Learning (with project context):")
    demo_level1 = generate_hints(python_code, python_task, project_path=".", filename="script.py")
    print("Generated conceptual hints:")
    print(demo_level1)

    # Level 2: Get implementation details with Level 1 context
    print("\n🔧 LEVEL 2 - Implementation Details (with Level 1 context):")
    demo_level2 = generate_level2_hints(demo_level1, "python", python_code, python_task)
    print("Generated HOW hints only:")
    print(demo_level2)

    # Level 3: Get CODE snippets with blanks
    print("\n💡 LEVEL 3 - CODE Snippets (with blanks):")
    demo_level3 = generate_level3_hints(demo_level2, "python", python_code, python_task)
    print("Generated CODE hints with blanks:")
    print(demo_level3)

    # Combined: Parse and enhance into CONCEPT + WHY + HOW + CODE
    print("\n🎯 COMBINED - Enhanced Hints:")
    demo_enhanced = parse_and_enhance_hints(demo_level1, demo_level2, demo_level3)
    print("Final enhanced hints with CONCEPT + WHY + HOW + CODE:")
    print(demo_enhanced)

    # Example 2: C++ Implementation
    print("\n\n2. C++ IMPLEMENTATION EXAMPLE:")
    cpp_code = "#include <iostream>\nint main() {\n    std::cout << \"Hello\" << std::endl;\n    return 0;\n}"
    cpp_task = "Add user input to get name and display greeting"

    print(f"Task: {cpp_task}")
    cpp_level1 = generate_hints(cpp_code, cpp_task, programming_language="cpp", filename="main.cpp")
    cpp_level2 = generate_level2_hints(cpp_level1, "cpp", cpp_code, cpp_task)
    cpp_level3 = generate_level3_hints(cpp_level2, "cpp", cpp_code, cpp_task)
    cpp_enhanced = parse_and_enhance_hints(cpp_level1, cpp_level2, cpp_level3)
    print("C++ Enhanced hints (with CODE):")
    print(cpp_enhanced)

    print("\n" + "=" * 40)
    print("Examples completed! The system is ready for user input.")