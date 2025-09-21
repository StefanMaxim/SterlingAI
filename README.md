# SterlingAI

Sterling is a Visual Studio Code extension that transforms how you learn programming. Instead of providing direct solutions, Sterling acts as an intelligent tutor that guides you through programming concepts step-by-step, helping you understand the "why" behind the code before showing you the "how."

## What Sterling Accomplishes

Sterling revolutionizes programming education by providing **progressive learning hints** that adapt to your understanding level. When you encounter challenging code or want to learn a new concept, Sterling doesn't just give you the answer—it teaches you to think like a programmer.

Sterling focuses on **conceptual learning** by helping you understand the fundamental concepts and reasoning behind programming solutions rather than just memorizing syntax. The extension provides **implementation guidance** through step-by-step hints that show you how to approach problems without spoiling the solution, allowing you to discover the answer yourself.

You'll receive **code templates** with strategic blanks to fill in, reinforcing your learning through active participation. The **progressive disclosure** system ensures you unlock learning levels gradually, building proper understanding at each stage. Sterling also features an **interactive Q&A** system where you can ask follow-up questions to deepen your understanding of any concept.

The extension offers **multi-language support** and works seamlessly with Python, JavaScript, TypeScript, C++, Java, and many other programming languages. Additionally, you can easily transfer your learning notes directly to your code files as properly formatted comments using the **copy to file** feature.

## How to Run Sterling Locally

### Prerequisites

Before setting up Sterling, ensure you have the following installed:

- **Node.js** (version 16 or higher)
- **Python** (version 3.8 or higher)
- **Visual Studio Code** (version 1.74.0 or higher)
- **Anthropic Claude API Key** (for AI functionality)

### Step 1: Clone and Setup the Project

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/sterling-extension.git
   cd sterling-extension
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

### Step 2: Configure API Key

1. **Create a `.env` file** in the project root:
   ```bash
   touch .env
   ```

2. **Add your Anthropic API key** to the `.env` file:
   ```
   ANTHROPIC_API_KEY=your_claude_api_key_here
   ```

   > **Get your API key**: Visit [Anthropic's website](https://console.anthropic.com/) to create an account and obtain your Claude API key.

### Step 3: Load Extension in VS Code

1. **Open VS Code**

2. **Open the extension project folder:**
   ```
   File → Open Folder → Select the sterling-extension directory
   ```

3. **Start the Extension Development Host:**
   - Press `F5` or go to `Run → Start Debugging`
   - This opens a new VS Code window with Sterling loaded

4. **Verify installation:**
   - In the new window, open any code file
   - Select some code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - You should see the Sterling Learning Assistant panel appear

### Step 4: Test Sterling

1. **Create a test file** (e.g., `test.py`, `test.js`, `test.cpp`)

2. **Add some code:**
   ```python
   # test.py
   def calculate_average(numbers):
       return sum(numbers) / len(numbers)
   ```

3. **Select the code** and press `Ctrl+Shift+L`

4. **Ask a question** like: "How can I add error handling to this function?"

5. **Explore the learning levels:**
   - Start with "🧠 Concept & Why" to understand the approach
   - Progress to "🔧 How (Implementation Hints)" for guidance
   - Finish with "💾 Code (with blanks)" for concrete examples

## How to Use Sterling

### Basic Workflow

1. **Select Code**: Highlight any code you want to learn about
2. **Trigger Sterling**: Press `Ctrl+Shift+P` or run "Ask Sterling" from Command Palette
3. **Ask Your Question**: Describe what you want to learn or accomplish
4. **Learn Progressively**:
   - **Level 1 (Concept)**: Understand the fundamental approach and reasoning
   - **Level 2 (How)**: Get implementation hints and guidance
   - **Level 3 (Code)**: See concrete code examples with blanks to fill
5. **Ask Follow-ups**: Use the chat interface for additional questions
6. **Copy to File**: Transfer useful insights directly to your code as comments

### File Structure

```
sterling-extension/
├── extension.js          # Main extension logic
├── api_client.py         # AI hint generation engine
├── package.json          # Node.js dependencies and VS Code config
├── requirements.txt      # Python dependencies
├── .env                  # API key configuration (create this)
├── media/
│   ├── interface.html    # Learning interface UI
│   ├── style.css         # Styling
│   └── webview.js        # Frontend interactions
└── README.md            # This file
```
## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Philosophy

Sterling believes that the best way to learn programming is through **guided discovery**, not rote copying. By providing progressive hints and encouraging you to think through problems step-by-step, Sterling helps you develop genuine understanding and problem-solving skills that will serve you throughout your programming journey.

Happy learning!