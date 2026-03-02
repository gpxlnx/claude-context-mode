#!/usr/bin/env node
/**
 * SessionStart hook for context-mode
 *
 * Provides the agent with XML-structured "Rules of Engagement"
 * at the beginning of each session, encouraging autonomous use
 * of context-mode MCP tools over raw Bash/Read/WebFetch.
 */

const ROUTING_BLOCK = `
<context_window_protection>
  <priority_instructions>
    Raw tool output floods your context window. You MUST use context-mode MCP tools to keep raw data in the sandbox.
  </priority_instructions>

  <tool_selection_hierarchy>
    1. GATHER: mcp__context-mode__batch_execute(commands, queries)
       - Primary tool for research. Runs all commands, auto-indexes, and searches.
       - ONE call replaces many individual steps.
    2. FOLLOW-UP: mcp__context-mode__search(queries: ["q1", "q2", ...])
       - Use for all follow-up questions. ONE call, many queries.
    3. PROCESSING: mcp__context-mode__execute(language, code) | mcp__context-mode__execute_file(path, language, code)
       - Use for API calls, log analysis, and data processing.
  </tool_selection_hierarchy>

  <forbidden_actions>
    - DO NOT use Bash for commands producing >20 lines of output.
    - DO NOT use Read for large files.
    - DO NOT use WebFetch (use mcp__context-mode__fetch_and_index instead).
    - Bash is ONLY for git/mkdir/rm/mv/navigation.
  </forbidden_actions>

  <output_constraints>
    <word_limit>Keep your final response under 500 words.</word_limit>
    <artifact_policy>
      Write artifacts (code, configs, PRDs) to FILES. NEVER return them as inline text.
      Return only: file path + 1-line description.
    </artifact_policy>
    <response_format>
      Your response must be a concise summary:
      - Actions taken (2-3 bullets)
      - File paths created/modified
      - Knowledge base source labels (so parent can search)
      - Key findings
    </response_format>
  </output_constraints>
</context_window_protection>`;

// Read stdin (SessionStart hook input — may be empty or minimal JSON)
let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) raw += chunk;

// Output the routing block as additionalContext
console.log(JSON.stringify({
  hookSpecificOutput: {
    additionalContext: ROUTING_BLOCK,
  },
}));
