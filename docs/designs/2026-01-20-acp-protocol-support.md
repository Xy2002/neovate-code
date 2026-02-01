# ACP Protocol Support (Agent Client Protocol Support)

**Date:** 2026-01-20

## Context

Agent Client Protocol (ACP) is a standardized protocol that allows AI Agents to integrate with various editors (such as Zed and VS Code). Currently, there is a standalone ACP implementation in the `neovate-code-acp-plugin` repository that works by launching an independent Neovate Server and connecting via a WebSocket client.

To better support the ACP protocol, we want to integrate ACP support as a built-in command (`neovate acp`) into the main project. The goals are:

- Reuse existing Context/Session/Loop logic
- Minimize intrusion into existing code
- Call Neovate APIs directly in-process without launching a separate server

## Discussion

We choose to integrate ACP support as a built-in command (`neovate acp`) using a lightweight adapter pattern. Main considerations:

**Why choose a built-in command:**

- ACP is a standard transport protocol and should be supported as a core feature, at the same level as `server`, `commit`, and other commands
- Easier for users to discover and use without installing additional plugins
- Better maintainability and test coverage

**Why reimplement:**

- acp-plugin requires launching a separate Neovate Server and communicating via WebSocket, introducing extra overhead
- The main project can call Context/Session APIs directly in-process for better performance
- More concise code (~500 lines vs 1000+ lines) with lower maintenance cost

**Why choose the adapter layer pattern:**

- Zero intrusion into existing code (Context/Session/Loop require no modifications)
- ACP's lifecycle and event model differ from Neovate Session; the adapter layer can elegantly handle the conversion
- Simple implementation, low risk, and follows the YAGNI principle

## Approach

Use a **lightweight adapter pattern** to implement ACP protocol support under `src/commands/acp/`. An adapter layer converts ACP protocol to calls to existing Neovate Context/Session APIs, achieving zero-intrusion integration.

### Core Features

1. **Command-line Entry** - Add `neovate acp` command, using the official ACP SDK (`@agentclientprotocol/sdk`) to handle stdio communication
2. **Session Adaptation** - ACPSession manages session lifecycle, handling message format conversion and streaming responses
3. **Tool Call Mapping** - Map Neovate's tool use/result to ACP's tool_call events, with special handling of `todoWrite` as plan
4. **Permission Handling** - Use ACP's `requestPermission` interface to handle tool approvals

## Architecture

### File Structure

Based on the sdesign of acp-plugin:

```
src/commands/acp/
  ├── index.ts                    # Command entry, register to CLI
  ├── agent.ts                    # NeovateACPAgent implementation
  ├── session.ts                  # ACPSession session management
  ├── types.ts                    # ACP-related type definitions
  ├── utils/
  │   ├── messageAdapter.ts       # Message format conversion
  │   └── streamHandler.ts        # Streaming response handling
```

### Data Flow Architecture

```
Zed / VS Code (ACP Client)
    ↓ stdin/stdout (JSON-RPC)
NeovateACPAgent
    ↓ initialize() → Create Context
    ↓ newSession() → Create ACPSession
    ↓ prompt() → Delegate to ACPSession
ACPSession (Adapter Layer)
    ↓ Format conversion (ACP ↔ Neovate)
    ↓ Streaming response / Event mapping
    ↓ Tool call adaptation
Neovate Core (No modifications)
    ↓ Context / Session / Loop / Tools
```

### Core Components

#### 1. Command Entry (`index.ts`)

- Use `AgentSideConnection` and `ndJsonStream` to handle stdio
- Create NeovateACPAgent instance
- Pass `contextCreateOpts` for creating Context

#### 2. ACPAgent (`agent.ts`)

- Implement ACP SDK's `Agent` interface
- `initialize()`: Create Context directly (no need to launch Server)
- `newSession()`: Create and manage ACPSession instances
- `prompt()` / `cancel()`: Delegate to ACPSession for processing

#### 3. ACPSession (`sessionHold a Neovate Session instance

- Obtain output through event listeners (`on('chunk')`, `on('toolUse')`, etc.)
- Use MessageAdapter for format conversion
- Special handling of `todoWrite`, mapping to ACP's plan update
- Handle permission approval requests

#### 4. MessageAdapter (`utils/messageAdapter.ts`)

- `fromACP()`: ACP ContentBlock[] → Neovate message format
- `toACPToolContent()`: Neovate ToolResult → ACP ToolCallContent[]
- `mapApprovalCategory()`: Neovate ApprovalCategory → ACP ToolCallKind
- Extract and convert diff information

#### 5. CLI Integration (`cli.ts`)

```typescript
program
  .command("acp")
  .description("Run as ACP (Agent Client Protocol) agent")
  .action(async () => {
    const { runACP } = await import("./commands/acp");
    await runACP({
      cwd: process.cwd(),
      contextCreateOpts: { quiet: true }, // Avoid stdout pollution
    });
  });
```

### Communication Method

```
┌─────────────┐  stdin/stdout   ┌─────────────────┐
│     Zed     │ ───────────────→ │   ACP Agent     │
└─────────────┘                  └────────┬────────┘
                                          │
                                  Create Context directly
                                          │
                                          ↓
                              ┌─────────────────────┐
                              │  ACPSession         │
                              │  (Adapter Layer)    │
                              └──────────┬──────────┘
                                         │ In-process API calls
                                         ↓
                              ┌─────────────────────┐
                              │  Context / Session  │
                              └─────────────────────┘
```

**Key Differences:**

- acp-plugin: Requires launching separate Server + WebSocket communication (cross-process)
- Main project: Create Context directly in-process and call APIs (zero network overhead)

### Modified Files Checklist

**New Files:**

- `src/commands/acp/index.ts`
- `src/commands/acp/agent.ts`
- `src/commands/acp/session.ts`
- `src/commands/acp/types.ts`
- `src/commands/acp/utils/messageAdapter.ts`
- `src/commands/acp/utils/streamHandler.ts`

**Modified Files:**

- `src/cli.ts` - Add `acp` command registration
- `package.json` - Add dependency `@agentclientprotocol/sdk`

**Zero Modification Files:**

- ✅ `src/context.ts`
- ✅ `src/session.ts`
- ✅ `src/loop.ts`
- ✅ `src/tool.ts`

### Assumptions

**Session API Requirements:**

- `Context.createSession()` - Create new session
- `Session.send()` - Send message and return Promise
- `Session.on()` - Listen to events (chunk, toolUse, toolResult, toolApproval)
- `Session.cancel()` - Cancel ongoing task

If these APIs don't exist, adjustments are needed to call the `loop()` function directly or use existing event mechanisms.

### Testing Strategy

**Unit Tests:**

- NeovateACPAgent initialization, session creation, message processing
- MessageAdapter format conversion correctness

**Integration Tests:**

- stdio communication with Zed
- Complete flow of streaming responses, tool calls, permission approvals

**Manual Tests:**
Configure Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Neovate": {
      "type": "custom",
      "command": "neovate",
      "args": ["acp"],
      "cwd": "/path/to/project"
    }
  }
}
```

Test scenarios: simple messages, tool calls, permission approvals, streaming output, cancel operations

### Future Extensions

1. **Session Persistence** - Implement `loadSession()` support
2. **More ACP Features** - `setSessionModel()`, `setSessionMode()`, `forkSession()`
3. **Performance Optimization** - Batch sessionUpdate processing, optimize large file diffs
4. **Enhanced Error Handling** - More detailed error messages and retry mechanisms
